import { makeConfig } from '../game/config';
import { runAiGame } from '../game/run';
import { ROLES } from '../game/roles';

// 不自然さの監査: 多数の試合を回し、ルール違反ではないが人間が読むと不自然な点を数える(scripts/audit.ts と tests から使う)
export interface NaturalnessResult { games: number; size: number; totalSay: number; totalDays: number; counts: Record<string, number>; examples: Record<string, string[]> }
export function runNaturalnessAudit(N: number, SZ: number, seed0 = 1): NaturalnessResult {
const cnt: Record<string, number> = {}; const ex: Record<string, string[]> = {};
const hit = (k: string, e?: string) => { cnt[k] = (cnt[k] ?? 0) + 1; if (e && (ex[k] ??= []).length < 3) ex[k].push(e); };
let totalSay = 0, totalDays = 0;
for (let s = seed0; s < seed0 + N; s++) {
  const { state } = runAiGame(s, makeConfig(SZ), { logging: false });
  const ev = state.events; const P = state.players;
  const nm = (i: number) => P[i].name;
  const deadAt = (i: number, day: number) => ev.some((x) => ((x.t === 'execute' && x.day < day) || (x.t === 'death' && x.day <= day)) && x.target === i);
  const days = Math.max(...ev.filter((x) => x.t === 'say').map((x: any) => x.day), 0); totalDays += days;
  // per-day structures
  const byDay = new Map<number, any[]>();
  for (const e of ev) if (e.t === 'say') { (byDay.get(e.day) ?? byDay.set(e.day, []).get(e.day)!).push(e); totalSay++; }
  const seerCo: number[] = [];
  const claimedSeer = new Set<number>(); const saidWhite = new Map<number, Set<number>>();
  const divined = new Map<number, Set<number>>();
  const execs = new Set<number>();
  for (const e of ev) {
    if (e.t === 'execute') execs.add(e.target);
    if (e.t !== 'say') continue;
    const st = e.st, t = st.target;
    const ctx = `s${s} d${e.day} ${nm(e.by)}(${P[e.by].role}): ${e.text}`;
    if (st.kind === 'co' && st.claim === 'seer' && !seerCo.includes(e.by)) seerCo.push(e.by);
    if ((st.kind === 'co' || st.kind === 'result') && st.claim === 'seer') { claimedSeer.add(e.by); if (st.color === 'white' && t != null) (saidWhite.get(e.by) ?? saidWhite.set(e.by, new Set()).get(e.by)!).add(t); }
    if (t != null && t === e.by && st.kind !== 'co' && st.kind !== 'result') hit('self_target', ctx);
    if (t != null && deadAt(t, e.day) && !['result', 'co', 'bite_logic', 'attack_review', 'confirm', 'medium_review', 'vote_review'].includes(st.kind)) hit('target_dead:' + st.kind, ctx);
    if (st.kind === 'co_timing' && st.tag === 'late' && seerCo.indexOf(t!) !== seerCo.length - 1) hit('late_not_last', ctx);
    // 視点の整合性: 占い師COが自分の白をライン指摘に含める / 対抗をかばう
    if (claimedSeer.has(e.by)) {
      const mine = saidWhite.get(e.by);
      if (st.kind === 'line' && ((t != null && mine?.has(t)) || (st.ref != null && mine?.has(st.ref)))) hit('claimant_line_own_white', ctx);
      if ((st.kind === 'defend' || st.kind === 'disagree' || (st.kind === 'co_timing' && st.tag === 'early')) && t != null && claimedSeer.has(t) && t !== e.by) hit('claimant_defends_rival', ctx);
    }
    if (st.kind === 'defend_self') hit('defend_self_used'); if (st.kind === 'disagree') hit('disagree_used'); if (st.tag === 'answer') hit('answer_used');
    if (st.kind === 'co_timing' && st.tag === 'early' && seerCo.indexOf(t!) !== 0) hit('early_not_first', ctx);
    if ((st.kind === 'co' || st.kind === 'result') && st.claim === 'seer' && t != null) {
      const d = divined.get(e.by) ?? divined.set(e.by, new Set()).get(e.by)!;
      if (d.has(t)) hit('divine_twice', ctx); d.add(t);
      if (deadAt(t, e.day - 1) && st.kind === 'result') hit('divine_dead', ctx);
    }
    if (st.kind === 'result' && st.claim === 'medium' && t != null && !execs.has(t)) hit('medium_not_executed', ctx);
    if (st.kind === 'count') { const alive = P.filter((p) => !deadAt(p.id, e.day)).length; if (st.n !== alive) hit('count_wrong', ctx + ` (実際${alive})`); }
    if (e.round > 0 && /^(おはよう|よろしく|皆さん|みなさん)/.test(e.text)) hit('greet_late', ctx);
    if (e.day > 1 && /おはよう|よろしく/.test(e.text) && e.round === 0) hit('greet_day2', ctx);
    if (/(さん)(さん)|。。|、、|です(わ|ばい)(わ|ばい)/.test(e.text)) hit('text_glitch', ctx);
  }
  // 狩人CO後の平和な朝には毎回護衛報告がある(本物)
  for (const p of P) {
    if (p.role !== 'hunter') continue;
    const coDay = ev.find((e) => e.t === 'say' && e.by === p.id && e.st.claim === 'hunter');
    if (!coDay || coDay.t !== 'say') continue;
    for (const e of ev) if (e.t === 'peace' && e.day > coDay.day && !deadAt(p.id, e.day) && ev.some((x) => x.t === 'say' && x.day === e.day)) {
      hit('gj_morning_after_co');
      if (!ev.some((x) => x.t === 'say' && x.day === e.day && x.by === p.id && x.st.kind === 'result' && x.st.claim === 'hunter')) hit('gj_not_reported', `s${s} d${e.day} ${nm(p.id)}`);
    }
  }
  // same-day contradictions & duplicate phrases
  for (const [day, list] of byDay) {
    const stance = new Map<number, Map<number, string>>();
    const texts = new Map<string, number[]>();
    for (const e of list) {
      const st = e.st, t = st.target;
      const m = stance.get(e.by) ?? stance.set(e.by, new Map()).get(e.by)!;
      const hostile = ['accuse', 'vote_intent', 'agree', 'silent_point', 'waver', 'vote_review', 'medium_review'].includes(st.kind) || (st.kind === 'co_timing' && st.tag === 'late') || (st.kind === 'bite_logic' && st.color === 'black');
      const friendly = st.kind === 'defend' || (st.kind === 'co_timing' && st.tag === 'early') || (st.kind === 'bite_logic' && st.color === 'white');
      if (t != null) {
        const prev = m.get(t);
        if (hostile && prev === 'f') hit('accuse_after_defend', `s${s} d${day} ${nm(e.by)} → ${nm(t)}: ${e.text}`);
        if (friendly && prev === 'h') hit('defend_after_accuse', `s${s} d${day} ${nm(e.by)} → ${nm(t)}: ${e.text}`);
        if (hostile) m.set(t, 'h'); if (friendly) m.set(t, 'f');
      }
      // normalize: strip names/emojis
      const norm = e.text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\S{1,3}(さん|はん)?/gu, '○').replace(/^(おはよう(ございます)?|よろしく(お願いします)?|皆さん|みなさん)[、。]?\s*/g, '');
      if (norm.length >= 12) (texts.get(norm) ?? texts.set(norm, []).get(norm)!).push(e.by);
    }
    for (const [tx, bys] of texts) if (new Set(bys).size >= 2) hit('dup_phrase_same_day', `s${s} d${day} ×${bys.length}: ${tx}`);
    // intent vs vote
    const intents = new Map<number, number>();
    for (const e of list) if (e.st.kind === 'vote_intent') intents.set(e.by, e.st.target);
    for (const e of ev) if (e.t === 'vote' && e.day === day && e.round === 0 && intents.has(e.by)) { hit('intent_total'); if (intents.get(e.by) !== e.target) hit('intent_changed', `s${s} d${day} ${nm(e.by)}(${P[e.by].role}) 宣言${nm(intents.get(e.by)!)} → 投票${nm(e.target)}`); }
    // asked but answered with wait
    const asked = new Set<number>();
    for (const e of list) { if (asked.has(e.by) && e.st.kind === 'wait' && e.st.tag !== 'asked') hit('asked_but_wait', `s${s} d${day} ${nm(e.by)}: ${e.text}`); if (e.st.kind === 'ask') asked.add(e.st.target); }
  }
}
return { games: N, size: SZ, totalSay, totalDays, counts: cnt, examples: ex };
}
