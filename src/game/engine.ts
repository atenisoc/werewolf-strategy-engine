import { renderStatement } from '../actions/templates';
import { CHARACTERS } from './config';
import { validateStatement, validateVote } from '../actions/statement';
import type { Agent, NightKind } from '../agents/types';
import { buildObservation, type PlayerObservation } from '../observations/observation';
import { streamRng } from '../util/rng';
import { ROLES } from './roles';
import type { GameState, PublicEvent, Statement, Winner, WolfPlan } from './types';

// 人間の入力待ち。AIだけの対戦ではyieldされない。
export type HumanRequest =
  | { type: 'plan'; playerId: number; obs: PlayerObservation; mates: number[] } // 人狼の作戦会議(人間が人狼のとき)
  | { type: 'talk'; playerId: number; obs: PlayerObservation; round: number }
  | { type: 'vote'; playerId: number; obs: PlayerObservation; candidates: number[] }
  | { type: 'night'; playerId: number; obs: PlayerObservation; kind: NightKind; candidates: number[] };
export type HumanResponse = Statement | number | WolfPlan;
type Gen<T> = Generator<HumanRequest, T, HumanResponse>;

export interface Hooks {
  onVotePhase?(day: number, state: GameState, agents: (Agent | null)[]): void;
}
export interface GameResult {
  winner: Winner;
  days: number;
}

const cw = (c: string) => (c === 'black' ? '黒(人狼)' : '白(人狼ではない)');

export function checkWinner(state: GameState): Winner | null {
  const alive = state.players.filter((p) => p.alive);
  const wolves = alive.filter((p) => ROLES[p.role].isWolf).length;
  const humans = alive.length - wolves;
  let w: Winner | null = null;
  if (wolves === 0) w = 'village';
  else if (wolves >= humans) w = 'wolf';
  // 村か人狼の勝利条件が満たされた時点で妖狐が生きていれば、妖狐の単独勝ち
  if (w && alive.some((p) => p.role === 'fox')) return 'fox';
  return w;
}

// ゲーム進行。AIには PlayerObservation だけを渡し、GameState は渡さない。
export function* playGame(state: GameState, agents: (Agent | null)[], hooks: Hooks = {}): Generator<HumanRequest, GameResult, HumanResponse> {
  const cfg = state.config;
  const P = state.players;
  const humanRng = streamRng(state.seed, 'humanText');
  const humanTemplates = new Map<string, number[]>();
  const emit = (ev: PublicEvent) => void state.events.push(Object.freeze(ev));
  const note = (to: number, text: string) => void state.notes.push({ idx: state.events.length, to, text });
  const aliveIds = () => P.filter((p) => p.alive).map((p) => p.id);
  const wolves = () => P.filter((p) => p.alive && ROLES[p.role].isWolf).map((p) => p.id);
  const finish = (w: Winner): GameResult => {
    state.winner = w;
    emit({ t: 'end', winner: w });
    return { winner: w, days: state.day };
  };

  // ---- 夜行動: 占い ----
  function* divineStep(day: number): Gen<void> {
    for (const s of P.filter((p) => p.alive && p.role === 'seer')) {
      const obs = buildObservation(state, s.id, { phase: 'night' });
      const done = new Set((obs.priv.seerResults ?? []).map((r) => r.target));
      const cands = aliveIds().filter((i) => i !== s.id && !done.has(i));
      if (!cands.length) continue;
      const ag = agents[s.id];
      const t = ag ? ag.night(obs, 'divine') : ((yield { type: 'night', playerId: s.id, obs, kind: 'divine', candidates: cands }) as number);
      if (validateVote(t, cands)) throw new Error(`anomaly: invalid divine target ${t} by ${s.id}`);
      const color = ROLES[P[t].role].seerColor;
      (state.priv.seer[s.id] ||= []).push({ day, target: t, color });
      note(s.id, `🔮 占い結果: ${P[t].name} は ${cw(color)} でした`);
      if (P[t].role === 'fox') cursed.push(t); // 呪殺: 朝に死亡(占い師本人にも理由は知らされない)
    }
  }
  let cursed: number[] = [];

  // ---- 夜0: 人狼の作戦会議 + 初日占い ----
  state.day = 0;
  state.phase = 'night';
  emit({ t: 'phase', day: 0, phase: 'night' });
  {
    const ws0 = wolves();
    const humanWolf = ws0.find((w) => !agents[w]);
    if (humanWolf != null) {
      // 人間の人狼がいれば、作戦は人間が決める
      const obs = buildObservation(state, humanWolf, { phase: 'night' });
      const mates = ws0.filter((w) => w !== humanWolf);
      const raw = (yield { type: 'plan', playerId: humanWolf, obs, mates }) as WolfPlan;
      const okFake = raw && (raw.fakeSeer == null || ws0.includes(raw.fakeSeer));
      const plan: WolfPlan = { fakeSeer: okFake ? raw.fakeSeer ?? null : null, kakoi: !!raw?.kakoi, cut: raw?.cut !== false };
      state.priv.wolfChat.push({ day: 0, by: humanWolf, kind: 'plan', fakeSeer: plan.fakeSeer, kakoi: plan.kakoi, cut: plan.cut });
    } else {
      for (const w of ws0) {
        const ag = agents[w];
        if (!ag) continue;
        const plan = ag.wolfPlan(buildObservation(state, w, { phase: 'night' }));
        if (plan) {
          state.priv.wolfChat.push({ day: 0, by: w, kind: 'plan', fakeSeer: plan.fakeSeer, kakoi: plan.kakoi, cut: plan.cut });
          break;
        }
      }
    }
  }
  if (cfg.firstNightDivine) yield* divineStep(0);
  // 初日占いで妖狐を引いた場合は1日目の朝に呪殺
  for (const c of cursed) {
    P[c].alive = false;
    emit({ t: 'death', day: 1, target: c });
  }
  cursed = [];

  for (let day = 1; day <= cfg.maxDays; day++) {
    // ================= 昼: 議論 =================
    state.day = day;
    state.phase = 'day';
    emit({ t: 'phase', day, phase: 'day' });
    for (let round = 0; round < cfg.rounds; round++) {
      for (const pid of aliveIds()) {
        const obs = buildObservation(state, pid, { phase: 'day', round });
        const ag = agents[pid];
        let st: Statement;
        let text: string;
        if (ag) {
          ({ st, text } = ag.talk(obs));
          const err = validateStatement(st, obs);
          if (err) throw new Error(`anomaly: ${err} (player ${pid}, day ${day})`);
        } else {
          st = (yield { type: 'talk', playerId: pid, obs, round }) as Statement;
          if (validateStatement(st, obs)) st = { kind: 'wait' };
          text = renderStatement(st, { nameOf: (i) => P[i].name, tone: 'plain', rng: humanRng, recent: humanTemplates, self: pid, greet: day === 1 && round === 0, gender: CHARACTERS[pid]?.gender, pref: cfg.dialect !== false ? CHARACTERS[pid]?.name : undefined });
        }
        emit({ t: 'say', day, round, by: pid, st, text });
      }
    }

    // ================= 昼: 投票 =================
    if (day > 1 || cfg.day1Vote) {
      state.phase = 'vote';
      emit({ t: 'phase', day, phase: 'vote' });
      hooks.onVotePhase?.(day, state, agents);
      function* collect(round: number, candsFor: (voter: number) => number[]): Gen<Map<number, number>> {
        const picks: [number, number][] = [];
        for (const v of aliveIds()) {
          const cands = candsFor(v);
          const obs = buildObservation(state, v, { phase: 'vote', round });
          const ag = agents[v];
          const t = ag ? ag.vote(obs, cands) : ((yield { type: 'vote', playerId: v, obs, candidates: cands }) as number);
          if (validateVote(t, cands)) throw new Error(`anomaly: invalid vote ${t} by ${v}`);
          picks.push([v, t]);
        }
        const counts = new Map<number, number>();
        for (const [v, t] of picks) {
          emit({ t: 'vote', day, round, by: v, target: t });
          counts.set(t, (counts.get(t) ?? 0) + 1);
        }
        return counts;
      }
      const tally = (counts: Map<number, number>) => {
        const max = Math.max(...counts.values());
        return { max, top: [...counts.entries()].filter(([, c]) => c === max).map(([t]) => t) };
      };
      let counts = yield* collect(0, (v) => aliveIds().filter((i) => i !== v));
      let { max, top } = tally(counts);
      if (top.length > 1) {
        const tied = top;
        counts = yield* collect(1, (v) => tied.filter((i) => i !== v));
        ({ max, top } = tally(counts));
      }
      const executed = top.length > 1 ? top[state.rng.int(top.length)] : top[0];
      P[executed].alive = false;
      emit({ t: 'execute', day, target: executed, votes: counts.get(executed) ?? max });
      const color = ROLES[P[executed].role].seerColor;
      state.priv.executed.push({ day, target: executed, color });
      for (const m of P.filter((p) => p.alive && p.role === 'medium')) note(m.id, `🕯 霊能結果: 処刑された ${P[executed].name} は ${cw(color)} でした`);
      const w1 = checkWinner(state);
      if (w1) return finish(w1);
    }

    // ================= 夜 =================
    state.phase = 'night';
    emit({ t: 'phase', day, phase: 'night' });
    // 人狼: 襲撃先の相談(各自が提案 → 人間の人狼がいればその人が決定、いなければ多数決)
    const ws = wolves();
    const proposals: number[] = [];
    let humanPick: number | null = null;
    for (const w of ws) {
      const obs = buildObservation(state, w, { phase: 'night' });
      const cands = aliveIds().filter((i) => !ROLES[P[i].role].isWolf);
      const ag = agents[w];
      if (ag) {
        const t = ag.night(obs, 'attack');
        if (validateVote(t, cands)) throw new Error(`anomaly: invalid attack ${t} by ${w}`);
        proposals.push(t);
        state.priv.wolfChat.push({ day, by: w, kind: 'target', target: t });
      } else {
        humanPick = (yield { type: 'night', playerId: w, obs, kind: 'attack', candidates: cands }) as number;
        if (validateVote(humanPick, cands)) humanPick = cands[0];
        state.priv.wolfChat.push({ day, by: w, kind: 'target', target: humanPick });
      }
    }
    let attack: number;
    if (humanPick != null) attack = humanPick;
    else {
      const cnt = new Map<number, number>();
      for (const t of proposals) cnt.set(t, (cnt.get(t) ?? 0) + 1);
      const mx = Math.max(...cnt.values());
      const top = [...cnt.entries()].filter(([, c]) => c === mx).map(([t]) => t);
      attack = top.length > 1 ? top[state.rng.int(top.length)] : top[0];
    }
    state.priv.wolfChat.push({ day, by: -1, kind: 'attack', target: attack });
    // 占い
    yield* divineStep(day);
    // 護衛
    const guards: { by: number; target: number }[] = [];
    for (const h of P.filter((p) => p.alive && p.role === 'hunter')) {
      const obs = buildObservation(state, h.id, { phase: 'night' });
      const lastG = (state.priv.guard[h.id] || []).slice(-1)[0]?.target;
      const cands = aliveIds().filter((i) => i !== h.id && !(cfg.noConsecutiveGuard && i === lastG));
      if (!cands.length) continue;
      const ag = agents[h.id];
      const t = ag ? ag.night(obs, 'guard') : ((yield { type: 'night', playerId: h.id, obs, kind: 'guard', candidates: cands }) as number);
      if (validateVote(t, cands)) throw new Error(`anomaly: invalid guard ${t} by ${h.id}`);
      (state.priv.guard[h.id] ||= []).push({ day, target: t });
      guards.push({ by: h.id, target: t });
      note(h.id, `🛡 ${P[t].name} を護衛しました`);
    }
    // 夜明け
    state.day = day + 1;
    state.phase = 'morning';
    emit({ t: 'phase', day: day + 1, phase: 'morning' });
    const gj = guards.filter((g) => g.target === attack);
    const deaths: number[] = [];
    if (gj.length) {
      for (const g of gj) note(g.by, `🛡 護衛成功! ${P[attack].name} が襲撃されましたが守りました`);
    } else if (P[attack].role === 'fox') {
      // 妖狐は襲撃で死なない(村から見ると「平和な朝」と区別がつかない)
    } else deaths.push(attack);
    for (const c of cursed) if (P[c].alive && !deaths.includes(c)) deaths.push(c);
    cursed = [];
    if (!deaths.length) emit({ t: 'peace', day: day + 1 });
    // 死体は番号順に出す(襲撃か呪殺かは公開しない)
    for (const d of deaths.sort((a, b) => a - b)) {
      P[d].alive = false;
      emit({ t: 'death', day: day + 1, target: d });
    }
    const w2 = checkWinner(state);
    if (w2) {
      state.day = day + 1;
      return finish(w2);
    }
  }
  return finish('draw');
}

// AIだけの対戦を最後まで実行する
export function runToEnd(state: GameState, agents: (Agent | null)[], hooks: Hooks = {}): GameResult {
  const gen = playGame(state, agents, hooks);
  const r = gen.next();
  if (!r.done) throw new Error('human input requested in AI-only game');
  return r.value;
}
