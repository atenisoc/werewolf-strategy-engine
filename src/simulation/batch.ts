import { ruleKey } from '../agents/rulekey';
import { ROLES } from '../game/roles';
import { runAiGame } from '../game/run';
import type { GameConfig, GameState, RoleId, Winner } from '../game/types';
import type { Agent } from '../agents/types';
import { PRESET_ORDER, PRESETS } from '../agents/personality';
import { auditInvariants, auditLeaks } from './audit';

export interface GameRecord {
  seed: number;
  winner: Winner | 'error';
  days: number;
  roles: RoleId[];
  personalities: string[];
  variants?: string[]; // 各席のAIバリアント名(--agent/--vs のとき)
  aliveEnd: boolean[];
  votes: number[]; // 各席の(1回目)投票数
  votesOnWolf: number[]; // うち人狼に入れた数
  error?: string;
}
export interface Anomaly {
  seed: number;
  kind: 'exception' | 'timeout' | 'invariant' | 'leak';
  message: string;
}
export interface TrajPoint {
  day: number;
  onWolf: number; // 村側プレイヤーが人狼に付けた疑惑度の平均
  onVillage: number; // 村側プレイヤーが他の村側に付けた疑惑度の平均
  samples: number;
}
// 推理ルール1件ごとの精度: 村側プレイヤーが付けた疑惑度の増減が、人狼に対して正しい向き(+)だったか
export interface RuleStat {
  key: string; // 名前・数字を伏せたラベル
  n: number;
  onWolf: number; // 人狼に付けたときの平均変化
  onVillage: number; // 村側に付けたときの平均変化
  hitRate: number; // 向きが正しかった割合(人狼に+、村側に-)
  share: number; // 人狼に付けた件数の割合(ルールが人狼を指した頻度)
}
// バリアント別(混合対戦 --vs のとき): 席数・陣営別勝率・投票精度
export interface VariantStat {
  name: string;
  seats: number;
  villageSideWinRate: number | null;
  wolfSideWinRate: number | null;
  voteAccuracy: number | null;
}
export interface PersonalityStat {
  key: string;
  name: string;
  seats: number;
  teamWinRate: number;
  villageSideWinRate: number | null;
  wolfSideWinRate: number | null;
  voteAccuracy: number | null;
  warning: string | null;
}
export interface Summary {
  games: number;
  errors: number;
  n: number;
  villageWinRate: number;
  wolfWinRate: number;
  foxWinRate: number;
  drawRate: number;
  avgDays: number;
  roleSurvival: Record<string, { count: number; survivedEnd: number; rate: number }>;
  voteAccuracy: { overall: number | null; byRole: Record<string, number | null> };
  trajectory: TrajPoint[];
  rankAuc?: number | null; // 順位精度: 村側が人狼を村側より高く疑っていたペアの割合(投票直前、0.5=当てずっぽう)
  rules?: RuleStat[];
  personalities: PersonalityStat[];
  variants?: VariantStat[];
  config: { n: number; roles: RoleId[]; weights: GameConfig['weights'] };
}
export interface BatchResult {
  summary: Summary;
  records: GameRecord[];
  anomalies: Anomaly[];
}
export interface BatchOptions {
  games: number;
  seed0: number;
  cfg: GameConfig;
  audit?: boolean;
  rules?: boolean; // 推理ルールごとの精度を集計する
  dump?: (row: string) => void; // 学習用の特徴量(投票直前の台帳をルールごとに集計)を1行ずつ書き出す
  variant?: string; // 全席に使うAIバリアント(src/agents/variants)
  vs?: string; // 混合対戦: baseline(または variant) と vs を席に交互に配る(seedの偶奇で入れ替え、役職の偏りを打ち消す)
}

const villageSide = (r: RoleId) => ROLES[r].camp === 'village';

// 大量対戦ランナー。CLIでもブラウザでも、step(k)を繰り返して使う。
export class BatchRunner {
  records: GameRecord[] = [];
  anomalies: Anomaly[] = [];
  done = 0;
  private traj = new Map<number, { w: number; wc: number; v: number; vc: number }>();
  private rules = new Map<string, { n: number; w: number; wn: number; v: number; vn: number; hit: number }>();
  private auc = { pairs: 0, hits: 0 };
  constructor(private o: BatchOptions) {}

  step(k: number): number {
    const end = Math.min(this.o.games, this.done + k);
    for (; this.done < end; this.done++) this.playOne(this.o.seed0 + this.done);
    return this.done;
  }

  private playOne(seed: number) {
    const cfg = { ...this.o.cfg, humanSeat: null };
    const seatVariants = this.seatVariants(seed, cfg.n);
    try {
      const { state, agents, result } = runAiGame(seed, cfg, {
        logging: false,
        variant: this.o.variant,
        seatVariants: seatVariants ?? undefined,
        hooks: {
          // 各日の投票直前に、村側プレイヤーの疑惑度を記録(人狼への疑惑度の推移)
          onVotePhase: (day, st, agents) => {
            let t = this.traj.get(day);
            if (!t) this.traj.set(day, (t = { w: 0, wc: 0, v: 0, vc: 0 }));
            for (const p of st.players) {
              if (!p.alive || !villageSide(p.role) ) continue;
              const s = agents[p.id]?.suspicions();
              if (!s) continue;
              if (this.o.dump) {
                const led = agents[p.id]?.ledger();
                const names = st.players.map((x) => x.name);
                if (led) for (const q of st.players) {
                  if (!q.alive || q.id === p.id) continue;
                  const isWolf = ROLES[q.role].isWolf;
                  if (!isWolf && !villageSide(q.role)) continue;
                  const f: Record<string, number> = {};
                  for (const it of led[q.id]) { const k = ruleKey(it.label, names); f[k] = (f[k] ?? 0) + it.delta; }
                  this.o.dump(JSON.stringify({ seed, day, y: isWolf ? 1 : 0, susp: s[q.id], f }));
                }
              }
              for (const q of st.players) {
                if (!q.alive || q.id === p.id) continue;
                if (ROLES[q.role].isWolf) { t.w += s[q.id]; t.wc++; }
                else if (villageSide(q.role)) { t.v += s[q.id]; t.vc++; }
              }
              // 順位精度(AUC): 人狼と村側の全ペアで、人狼の方を高く見ている割合
              const wolves = st.players.filter((q) => q.alive && q.id !== p.id && ROLES[q.role].isWolf);
              const vils = st.players.filter((q) => q.alive && q.id !== p.id && villageSide(q.role));
              for (const a of wolves) for (const b of vils) { this.auc.pairs++; if (s[a.id] > s[b.id]) this.auc.hits++; else if (s[a.id] === s[b.id]) this.auc.hits += 0.5; }
            }
          },
        },
      });
      if (this.o.rules) this.collectRules(state, agents);
      const votes = Array(cfg.n).fill(0);
      const hits = Array(cfg.n).fill(0);
      for (const e of state.events) {
        if (e.t === 'vote' && e.round === 0) {
          votes[e.by]++;
          if (ROLES[state.players[e.target].role].isWolf) hits[e.by]++;
        }
      }
      this.records.push({
        seed, winner: result.winner, days: state.day, roles: state.players.map((p) => p.role),
        personalities: state.players.map((p) => p.personalityKey), variants: seatVariants ?? undefined, aliveEnd: state.players.map((p) => p.alive), votes, votesOnWolf: hits,
      });
      for (const m of auditInvariants(state)) this.anomalies.push({ seed, kind: m.startsWith('game did not finish') ? 'timeout' : 'invariant', message: m });
      if (this.o.audit) for (const m of auditLeaks(state)) this.anomalies.push({ seed, kind: 'leak', message: m });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.anomalies.push({ seed, kind: 'exception', message: msg });
      this.records.push({ seed, winner: 'error', days: 0, roles: [], personalities: [], aliveEnd: [], votes: [], votesOnWolf: [], error: msg });
    }
  }

  // 混合対戦の席割り: 偶数席/奇数席に交互に配り、seedが奇数なら入れ替える(配役は席と独立なので、長期的に両者が同じ役職分布を引く)
  private seatVariants(seed: number, n: number): string[] | null {
    if (!this.o.vs) return null;
    const a = this.o.variant ?? 'baseline';
    const b = this.o.vs;
    const flip = seed % 2 === 1;
    return Array.from({ length: n }, (_, i) => ((i % 2 === 0) !== flip ? a : b));
  }

  // 台帳のラベルから名前と数字を伏せて、ルールごとに集計する
  private collectRules(state: GameState, agents: (Agent | null)[]) {
    const names = state.players.map((p) => p.name);
    const norm = (label: string) => ruleKey(label, names);
    for (const p of state.players) {
      if (!villageSide(p.role)) continue;
      const led = agents[p.id]?.ledger();
      if (!led) continue;
      for (const q of state.players) {
        if (q.id === p.id) continue;
        const isWolf = ROLES[q.role].isWolf;
        if (!isWolf && !villageSide(q.role)) continue; // 妖狐は対象外
        for (const it of led[q.id]) {
          if (it.day === 0) continue; // 初期値・第一印象は除く
          const k = norm(it.label);
          let r = this.rules.get(k);
          if (!r) this.rules.set(k, (r = { n: 0, w: 0, wn: 0, v: 0, vn: 0, hit: 0 }));
          r.n++;
          if (isWolf) { r.w += it.delta; r.wn++; if (it.delta > 0) r.hit++; }
          else { r.v += it.delta; r.vn++; if (it.delta < 0) r.hit++; }
        }
      }
    }
  }

  finish(): BatchResult {
    const ruleStats: RuleStat[] = [...this.rules.entries()]
      .map(([key, r]) => ({ key, n: r.n, onWolf: r.wn ? r.w / r.wn : 0, onVillage: r.vn ? r.v / r.vn : 0, hitRate: r.n ? r.hit / r.n : 0, share: r.n ? r.wn / r.n : 0 }))
      .sort((a, b) => b.n - a.n);
    const summary = summarize(this.records, this.o.cfg, this.traj);
    summary.rankAuc = this.auc.pairs ? this.auc.hits / this.auc.pairs : null;
    summary.rules = this.o.rules ? ruleStats : undefined;
    return { summary, records: this.records, anomalies: this.anomalies };
  }
}

export function runBatch(o: BatchOptions): BatchResult {
  const r = new BatchRunner(o);
  r.step(o.games);
  return r.finish();
}

function rate(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

function summarize(records: GameRecord[], cfg: GameConfig, traj: Map<number, { w: number; wc: number; v: number; vc: number }>): Summary {
  const ok = records.filter((r) => r.winner !== 'error');
  const vw = ok.filter((r) => r.winner === 'village').length;
  const ww = ok.filter((r) => r.winner === 'wolf').length;
  const dw = ok.filter((r) => r.winner === 'draw').length;
  const fw = ok.filter((r) => r.winner === 'fox').length;
  const roleSurvival: Summary['roleSurvival'] = {};
  const roleVotes: Record<string, [number, number]> = {};
  let allV = 0;
  let allH = 0;
  type Acc = { seats: number; wins: number; vSeats: number; vWins: number; wSeats: number; wWins: number; votes: number; hits: number };
  const pacc: Record<string, Acc> = {};
  for (const k of PRESET_ORDER) pacc[k] = { seats: 0, wins: 0, vSeats: 0, vWins: 0, wSeats: 0, wWins: 0, votes: 0, hits: 0 };
  for (const r of ok) {
    r.roles.forEach((role, i) => {
      const rs = (roleSurvival[role] ||= { count: 0, survivedEnd: 0, rate: 0 });
      rs.count++;
      if (r.aliveEnd[i]) rs.survivedEnd++;
      const camp = ROLES[role].camp;
      const won = r.winner === camp;
      const a = pacc[r.personalities[i]];
      a.seats++;
      if (won) a.wins++;
      if (camp === 'fox') {
        // 妖狐は席数が少ないので性格別の集計には含めない
      } else if (camp === 'village') {
        a.vSeats++;
        if (won) a.vWins++;
        (roleVotes[role] ||= [0, 0]);
        roleVotes[role][0] += r.votesOnWolf[i];
        roleVotes[role][1] += r.votes[i];
        allH += r.votesOnWolf[i];
        allV += r.votes[i];
        a.votes += r.votes[i];
        a.hits += r.votesOnWolf[i];
      } else {
        a.wSeats++;
        if (won) a.wWins++;
      }
    });
  }
  for (const rs of Object.values(roleSurvival)) rs.rate = rs.count ? rs.survivedEnd / rs.count : 0;
  const byRole: Record<string, number | null> = {};
  for (const [k, [h, v]] of Object.entries(roleVotes)) byRole[k] = rate(h, v);

  // 性格が強すぎないか: 同じ陣営の全体平均との差が大きい性格を警告
  const vAll = rate(Object.values(pacc).reduce((s, a) => s + a.vWins, 0), Object.values(pacc).reduce((s, a) => s + a.vSeats, 0));
  const wAll = rate(Object.values(pacc).reduce((s, a) => s + a.wWins, 0), Object.values(pacc).reduce((s, a) => s + a.wSeats, 0));
  const personalities: PersonalityStat[] = PRESET_ORDER.map((k) => {
    const a = pacc[k];
    const v = rate(a.vWins, a.vSeats);
    const w = rate(a.wWins, a.wSeats);
    const msgs: string[] = [];
    if (v != null && vAll != null && a.vSeats >= 150 && Math.abs(v - vAll) > 0.1) msgs.push(`村側で勝率が全体より${v > vAll ? '高い' : '低い'}(${((v - vAll) * 100).toFixed(0)}pt)`);
    if (w != null && wAll != null && a.wSeats >= 80 && Math.abs(w - wAll) > 0.12) msgs.push(`人狼側で勝率が全体より${w > wAll ? '高い' : '低い'}(${((w - wAll) * 100).toFixed(0)}pt)`);
    return {
      key: k, name: PRESETS[k].name, seats: a.seats, teamWinRate: a.seats ? a.wins / a.seats : 0, villageSideWinRate: v, wolfSideWinRate: w,
      voteAccuracy: rate(a.hits, a.votes), warning: msgs.length ? msgs.join(' / ') : null,
    };
  });

  // バリアント別(混合対戦のとき)
  let variants: VariantStat[] | undefined;
  if (ok.some((r) => r.variants)) {
    const vacc: Record<string, Acc> = {};
    for (const r of ok) r.roles.forEach((role, i) => {
      const k = r.variants?.[i] ?? 'baseline';
      const a = (vacc[k] ||= { seats: 0, wins: 0, vSeats: 0, vWins: 0, wSeats: 0, wWins: 0, votes: 0, hits: 0 });
      const camp = ROLES[role].camp;
      const won = r.winner === camp;
      a.seats++;
      if (won) a.wins++;
      if (camp === 'village') { a.vSeats++; if (won) a.vWins++; a.votes += r.votes[i]; a.hits += r.votesOnWolf[i]; }
      else if (camp === 'wolf') { a.wSeats++; if (won) a.wWins++; }
    });
    variants = Object.entries(vacc).map(([name, a]) => ({ name, seats: a.seats, villageSideWinRate: rate(a.vWins, a.vSeats), wolfSideWinRate: rate(a.wWins, a.wSeats), voteAccuracy: rate(a.hits, a.votes) }));
  }

  const trajectory = [...traj.entries()].sort((x, y) => x[0] - y[0]).map(([day, t]) => ({
    day, onWolf: t.wc ? t.w / t.wc : 0, onVillage: t.vc ? t.v / t.vc : 0, samples: t.wc,
  }));
  return {
    games: records.length, errors: records.length - ok.length, n: cfg.n,
    villageWinRate: ok.length ? vw / ok.length : 0, wolfWinRate: ok.length ? ww / ok.length : 0, foxWinRate: ok.length ? fw / ok.length : 0, drawRate: ok.length ? dw / ok.length : 0,
    avgDays: ok.length ? ok.reduce((s, r) => s + r.days, 0) / ok.length : 0,
    roleSurvival, voteAccuracy: { overall: rate(allH, allV), byRole }, trajectory, personalities, variants,
    config: { n: cfg.n, roles: cfg.roles, weights: cfg.weights },
  };
}
