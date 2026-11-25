import { renderStatement } from '../actions/templates';
import { applyViewpoint } from './viewpoint';
import { CHARACTERS } from '../game/config';
import type { Behavior, Personality, PublicEvent, RoleId, ScoreWeights, Statement, WolfPlan } from '../game/types';
import type { ThinkEntry } from '../logs/think';
import type { PlayerObservation } from '../observations/observation';
import type { Rng } from '../util/rng';
import { Belief } from './belief';
import { baseTalkCands } from './candidates';
import { scoreCands } from './decision';
import { toneOf } from './personality';
import { STRATEGIES } from './roles';
import { makeFlags, type Flags } from './flags';
import type { Agent, AgentMemory, Cand, Ctx, NightKind, RoleStrategy } from './types';

export interface AgentOpts {
  id: number;
  personality: Personality;
  rng: Rng;
  weights: ScoreWeights;
  behavior: Behavior;
  logging?: boolean;
  // 役職戦略の差し替え(拡張用)。省略した役職は既定の STRATEGIES を使う。
  // 例: { villager: myVillager } で村人の戦術だけ入れ替える。
  strategies?: Partial<Record<RoleId, RoleStrategy>>;
}

// 襲撃・護衛は「読み合い」なので、昼の発言より迷いを大きくする(乱数の比率を上げる)
const NIGHT_NOISE_BOOST: Record<NightKind, number> = { divine: 1, guard: 3, attack: 3 };
const sign = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(0);

// ルールベースAI本体。
//   PlayerObservation → Belief更新 → 候補行動生成 → スコアリング(ルール+性格+乱数) → 行動決定 → テンプレ発言
// 受け取るのは PlayerObservation だけ。GameState(真の状態)には触れない。
export class RuleAgent implements Agent {
  readonly id: number;
  readonly personality: Personality;
  log: ThinkEntry[] = [];
  private rng: Rng;
  private weights: ScoreWeights;
  private beh: Behavior;
  private logging: boolean;
  private belief?: Belief;
  private flags: Flags;
  private strat!: RoleStrategy;
  private mem!: AgentMemory;
  private strategies: Record<RoleId, RoleStrategy>;

  constructor(o: AgentOpts) {
    this.id = o.id;
    this.personality = o.personality;
    this.rng = o.rng;
    this.weights = o.weights;
    this.beh = o.behavior;
    this.logging = o.logging ?? true;
    this.flags = makeFlags(o.behavior);
    this.strategies = { ...STRATEGIES, ...(o.strategies ?? {}) };
  }

  suspicions(): number[] | null {
    return this.belief ? [...this.belief.susp] : null;
  }
  ledger() {
    return this.belief ? this.belief.ledger : null;
  }

  // ---- 準備: 観測を取り込んで判断用の文脈を作る ----
  private prepare(obs: PlayerObservation, dry = false): Ctx {
    const role = obs.self.role;
    if (!this.belief) {
      this.belief = new Belief({
        me: obs.self.id, n: obs.config.n, selfRole: role, names: obs.players.map((p) => p.name),
        personality: this.personality, usePrivate: role === 'seer' || role === 'medium' || role === 'mason',
        roleCounts: obs.config.roleCounts, rng: this.rng, flags: this.flags, w: this.beh.w as never,
        humanSeat: obs.config.humanSeat, humanRep: obs.config.humanRep,
      });
      this.strat = this.strategies[role];
      this.mem = {
        coDone: false, seerCoPlan: false, reportedSeer: 0, reportedMedium: 0, askedCo: false,
        spoken: new Map(), spokenDay: -1, fake: { plan: false, claim: 'seer', results: [], reported: 0, genDay: -1 }, templates: new Map(), whyOf: {}, gjReportedDay: -1,
      };
      this.strat.init?.(this.mem, { rng: this.rng, beh: this.beh });
    }
    const b = this.belief;
    b.update(obs);
    if (this.mem.spokenDay !== obs.day) {
      this.mem.spoken.clear();
      this.mem.spokenDay = obs.day;
    }
    const alive = obs.players.filter((p) => p.alive).map((p) => p.id);
    return {
      obs, b, me: obs.self.id, role, day: obs.day, round: obs.round, rounds: obs.config.rounds, alive,
      others: alive.filter((i) => i !== obs.self.id), mem: this.mem, p: this.personality, rng: this.rng, beh: this.beh,
      mates: new Set(obs.priv.wolfMates ?? obs.priv.masonMates ?? []), dry, name: (i) => obs.players[i].name, f: this.flags,
    };
  }

  private talkCands(ctx: Ctx): Cand[] {
    const cands = [...baseTalkCands(ctx, this.strat), ...(this.strat.talkExtras?.(ctx) ?? [])];
    return applyViewpoint(ctx, cands.map((c) => {
      const bonus = this.strat.bonus?.(ctx, c) ?? 0;
      return bonus ? { ...c, rule: c.rule + bonus } : c;
    }), 'talk');
  }
  private voteCands(ctx: Ctx, candidates: number[]): Cand[] {
    let allowed = candidates.filter((t) => this.strat.targetOk?.(ctx, t, 'vote') !== false);
    if (!allowed.length) allowed = candidates;
    const intent = this.flags.on('v_sticky_intent') && this.mem.intent?.day === ctx.day ? this.mem.intent.target : null;

    return applyViewpoint(ctx, allowed.map((t) => ({
      key: `vote:${t}`, label: `${ctx.name(t)}に投票`, kind: 'vote' as const, pers: 'vote' as const, target: t,
      // 自分の宣言どおりに入れやすくする(※多数派に票を寄せる補正は村側の勝率を下げたので入れていない)
      rule: (this.strat.voteRule?.(ctx, t) ?? ctx.b.susp[t] - ctx.b.rolePenalty(t) + ctx.b.foxPressure(t)) + (t === intent ? 40 : 0), heat: ctx.b.heat(t),
    })), 'vote');
  }

  // ---- 発言 ----
  talk(obs: PlayerObservation): { st: Statement; text: string } {
    const ctx = this.prepare(obs);
    const { scored, best } = scoreCands(this.talkCands(ctx), this.personality, this.weights, this.rng, false);
    const cand = best.cand;
    let st = cand.st as Statement;
    // 根拠は毎回言うとくどいので、6割だけ付ける。同じ根拠の連続も避ける。
    if (st.reason && (st.reason === this.mem.lastReason || this.rng() > 0.6)) st = { ...st, reason: undefined };
    if (st.reason) this.mem.lastReason = st.reason;
    const todayTexts = obs.events.filter((e): e is Extract<PublicEvent, { t: 'say' }> => e.t === 'say' && e.day === obs.day).map((e) => e.text);
    const text = renderStatement(st, { nameOf: ctx.name, tone: toneOf(this.personality), rng: this.rng, recent: this.mem.templates, self: obs.self.id, greet: obs.day === 1 && obs.round === 0, gender: CHARACTERS[obs.self.id]?.gender, pref: obs.config.dialect ? CHARACTERS[obs.self.id]?.name : undefined, todayTexts });
    this.mem.spoken.set(cand.key, (this.mem.spoken.get(cand.key) ?? 0) + 1);
    if (cand.kind === 'ask_co') this.mem.askedCo = true;
    if (cand.kind === 'vote_intent' && cand.target != null) this.mem.intent = { day: ctx.day, target: cand.target };
    if (cand.kind === 'co') this.mem.coDone = true;
    this.strat.onSpoke?.(ctx, cand);
    this.record(ctx, 'talk', scored, cand, text);
    return { st, text };
  }

  // ---- 投票 ----
  vote(obs: PlayerObservation, candidates: number[]): number {
    const ctx = this.prepare(obs);
    const { scored, best } = scoreCands(this.voteCands(ctx, candidates), this.personality, this.weights, this.rng, false);
    this.record(ctx, 'vote', scored, best.cand);
    return best.cand.target as number;
  }

  // ---- 夜行動(占い/護衛/襲撃先の提案) ----
  night(obs: PlayerObservation, kind: NightKind): number {
    const ctx = this.prepare(obs);
    const cands = this.strat.nightCands?.(ctx, kind) ?? [];
    if (!cands.length) return ctx.rng.pick(ctx.others);
    const { scored, best } = scoreCands(cands, this.personality, this.weights, this.rng, false, NIGHT_NOISE_BOOST[kind]);
    this.record(ctx, 'night', scored, best.cand);
    const t = best.cand.target as number;
    if (kind === 'divine') {
      // 占った理由(結果報告に添える)。乱数は使わない
      const s = ctx.b.susp[t];
      this.mem.whyOf[t] = s >= 45 ? 'suspect' : obs.config.roleCounts.fox > 0 && s < 30 ? 'fox' : ctx.b.spokeCount(t) <= 1 ? 'quiet' : 'trusted';
    }
    return t;
  }

  wolfPlan(obs: PlayerObservation): WolfPlan | null {
    const ctx = this.prepare(obs);
    const plan = this.strat.wolfPlan?.(ctx) ?? null;
    if (plan && this.logging) {
      this.log.push({
        day: 0, phase: 'wolfplan', round: 0, playerId: this.id, playerName: ctx.name(this.id), role: ctx.role, personality: this.personality.name,
        suspicion: [], candidates: [], chosen: (plan.fakeSeer == null ? '偽COなし' : `${ctx.name(plan.fakeSeer)}が占い師を騙る`) + (plan.kakoi ? '／囲いあり' : '') + (plan.cut ? '／身内切りあり' : '／身内切りなし'),
        internal: [`仲間: ${[...ctx.mates].map(ctx.name).join('、')}`],
      });
    }
    return plan;
  }

  // ---- 初心者向けヒント: 乱数なしでAIならどうするかを返す。状態は変えない ----
  advise(obs: PlayerObservation, mode: 'talk' | 'vote' | 'night', extra?: { candidates?: number[]; night?: NightKind }): { label: string; why: string[] }[] {
    const ctx = this.prepare(obs, true);
    let cands: Cand[];
    if (mode === 'talk') cands = this.talkCands(ctx);
    else if (mode === 'vote') cands = this.voteCands(ctx, extra?.candidates ?? ctx.others);
    else cands = this.strat.nightCands?.(ctx, extra?.night ?? 'divine') ?? [];
    if (!cands.length) return [];
    const { scored } = scoreCands(cands, this.personality, this.weights, this.rng, true);
    return scored
      .sort((a, b) => b.info.total - a.info.total)
      .slice(0, 3)
      .map((s) => ({
        label: s.cand.label,
        why: s.cand.target != null ? ctx.b.topItems(s.cand.target, 3).map((i) => `${i.label} ${sign(i.delta)}`) : [],
      }));
  }

  private record(ctx: Ctx, phase: ThinkEntry['phase'], scored: { cand: Cand; info: ThinkEntry['candidates'][number] }[], chosen: Cand, text?: string) {
    if (!this.logging) return;
    const b = ctx.b;
    const susp = [...ctx.others]
      .sort((x, y) => b.susp[y] - b.susp[x])
      .map((i) => ({ id: i, name: ctx.name(i), value: b.susp[i], items: b.topItems(i, 4).map((x) => ({ label: x.label, delta: x.delta })) }));
    this.log.push({
      day: ctx.day, phase, round: ctx.round, playerId: ctx.me, playerName: ctx.name(ctx.me), role: ctx.role, personality: this.personality.name,
      suspicion: susp,
      candidates: [...scored].sort((a, c) => c.info.total - a.info.total).slice(0, 6).map((s) => s.info),
      chosen: chosen.label,
      text,
      internal: this.strat.internal?.(ctx, chosen),
    });
  }
}
