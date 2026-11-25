import type { Cand, Ctx, NightKind, RoleStrategy } from '../types';
import { fakeOnSpoke, fakeSeerExtras, otherSeerClaims } from './fake';

// 人狼AIの心臓部:
//   「内部で認識している真実」(仲間・本物の占い師候補など)と
//   「表向きに発言する内容」(村人のふりをした疑惑度ベースの発言)を分けて持つ。
//   表向きの判断(ctx.b)は"公開情報だけで作った疑惑度"。人狼の内部知識は
//   仲間の除外・偽CO・襲撃先の選定にだけ使う。

function planMsg(ctx: Ctx) {
  for (const m of ctx.obs.priv.wolfChat ?? []) if (m.kind === 'plan') return m;
  return null;
}
function fakeSeerId(ctx: Ctx): number | null {
  return planMsg(ctx)?.fakeSeer ?? null;
}
// 身内切りの方針(作戦会議で決める。既定あり)
export function cutOk(ctx: Ctx): boolean {
  return ctx.f.on('w_mates_cut') && (planMsg(ctx)?.cut ?? true);
}
// 囲いの方針
export function kakoiOk(ctx: Ctx): boolean {
  return planMsg(ctx)?.kakoi ?? false;
}
const isWolfSide = (ctx: Ctx, t: number) => t === ctx.me || ctx.mates.has(t);

// 内部知識: 占い師COの判定を"真実"と照合する。
//   人狼は誰が人狼かを知っているので、「人狼に黒 / 人狼以外に白」を出した人は本物の可能性が高く、
//   外れた判定を出した人は確実に偽物(=狂人)だとわかる。
//   返り値: 本物らしさの相対重み(0 = 偽物確定)
export function claimantRealness(ctx: Ctx, c: number): number {
  const claim = ctx.b.seerClaims.get(c);
  if (!claim || isWolfSide(ctx, c)) return 0;
  if (!ctx.f.on('w_truth_check')) return 1; // 照合しない: 全員同じ重み
  let w = 1;
  for (const r of claim.results) {
    const truth = ctx.mates.has(r.target) || r.target === ctx.me ? 'black' : 'white';
    if (r.color !== truth) return 0; // 真実と違う判定 → 偽物(狂人)
    w *= r.color === 'black' ? 6 : 1.6; // 当たっている黒は本物の強い証拠、白は弱い証拠
  }
  return w;
}

// 内部知識: 生存している非仲間のうち、本物の占い師である確率
export function seerLikely(ctx: Ctx): Map<number, number> {
  const claimants = [...ctx.b.seerClaims.keys()].filter((c) => ctx.b.aliveNow[c] && !isWolfSide(ctx, c));
  const weights = claimants.map((c) => claimantRealness(ctx, c));
  const sum = weights.reduce((a, b) => a + b, 0);
  const m = new Map<number, number>();
  for (const t of ctx.others) {
    if (ctx.mates.has(t)) continue;
    const i = claimants.indexOf(t);
    if (i >= 0) m.set(t, sum > 0 ? (0.92 * weights[i]) / sum : 0.1);
    else m.set(t, claimants.length ? (sum > 0 ? 0.01 : 0.05) : 0.1);
  }
  return m;
}
// 偽物確定(狂人)の占い師CO
function isKnownMadman(ctx: Ctx, t: number): boolean {
  if (!ctx.f.on('w_avoid_madman')) return false;
  return ctx.b.seerClaims.has(t) && !isWolfSide(ctx, t) && claimantRealness(ctx, t) === 0;
}
function likelyRealSeer(ctx: Ctx): number | null {
  const sl = seerLikely(ctx);
  let best: number | null = null;
  for (const [t, p] of sl) if (p >= 0.6 && (best == null || p > (sl.get(best) ?? 0))) best = t;
  return best;
}
// 護衛成功(平和な朝)が出た夜に自分たちが襲った相手 → 狩人に守られている
function guardedTargets(ctx: Ctx): Set<number> {
  const out = new Set<number>();
  const peaceDays = new Set<number>();
  for (const e of ctx.obs.events) if (e.t === 'peace') peaceDays.add(e.day); // 朝の日付 = 襲撃した夜の日 + 1
  // その夜に実際に決まった襲撃先(kind:'attack'、1夜1件)だけを数える(各人狼の提案先は襲っていない)
  for (const m of ctx.obs.priv.wolfChat ?? []) if (m.kind === 'attack' && m.target != null && peaceDays.has(m.day + 1)) out.add(m.target);
  return out;
}
// 妖狐の疑い: 襲撃したのに2回以上「平和な朝」になった相手(狩人が毎回守るとは考えにくい)
function foxSuspects(ctx: Ctx): Set<number> {
  const out = new Set<number>();
  if (ctx.obs.config.roleCounts.fox === 0) return out;
  const peaceDays = new Set<number>();
  for (const e of ctx.obs.events) if (e.t === 'peace') peaceDays.add(e.day);
  const cnt = new Map<number, number>();
  for (const m of ctx.obs.priv.wolfChat ?? []) if (m.kind === 'attack' && m.target != null && peaceDays.has(m.day + 1)) cnt.set(m.target, (cnt.get(m.target) ?? 0) + 1);
  const need = ctx.obs.config.noConsecutiveGuard ? 2 : 3;
  for (const [t, c] of cnt) if (c >= need && ctx.b.aliveNow[t]) out.add(t);
  return out;
}
// 仲間(自分含む)の偽占いが黒を出した相手
function blackedByUs(ctx: Ctx, t: number): boolean {
  for (const [by, c] of ctx.b.seerClaims) if (isWolfSide(ctx, by) && c.results.some((r) => r.target === t && r.color === 'black')) return true;
  if (ctx.mem.fake.results.some((r) => r.target === t && r.color === 'black')) return true;
  return false;
}

// 本物の占い師を吊りに行ってよい状況か: 対抗COがいて、かつ他の人も疑い始めている(自分から言い出すと目立つ)
function pushSeerOk(ctx: Ctx, t: number): boolean {
  if (!ctx.b.seerClaims.has(t)) return false;
  if (!ctx.f.on('w_push_gate')) return true;
  if (ctx.b.seerClaims.size < 2) return false;
  return ctx.day >= 2 || ctx.b.heat(t) >= 0.25 || ctx.b.seerTrust(t) < 0.3;
}

export const werewolf: RoleStrategy = {
  talkExtras(ctx) {
    const out: Cand[] = fakeSeerExtras(ctx, 'wolf', fakeSeerId(ctx) === ctx.me, likelyRealSeer(ctx));
    // 吊り逃れの狩人騙り: 名指しが集中していて、まだ狩人COが誰もおらず、自分が占い騙り中でないとき。
    // その日は吊られにくくなるが、人狼は仲間を噛まないので翌日以降「噛まれない狩人CO」として疑われる(1日稼ぐ手)
    if (ctx.f.on('w_hunter_fake') && !ctx.mem.coDone && fakeSeerId(ctx) !== ctx.me && ctx.b.hunterClaims.size === 0 && (ctx.b.heat(ctx.me) >= 0.25 || ctx.b.accusersOfMe() >= 3) && (ctx.day > 1 || ctx.obs.config.day1Vote)) {
      if (ctx.mem.hunterFake == null && !ctx.dry) ctx.mem.hunterFake = ctx.rng.chance(ctx.f.v('wolfHunterFakeP'));
      if (ctx.mem.hunterFake) out.push({ key: 'co', label: '狩人を騙ってCO(吊り逃れ)', kind: 'co', pers: 'neutral', heat: 0, rule: 95, must: true, st: { kind: 'co', claim: 'hunter' } });
    }
    // 仲間をかばう(露骨だと怪しまれるので、疑われ始めたときだけ控えめに。吊られそうな仲間をかばうと後で疑われるのでやめる)
    for (const t of ctx.others.filter((x) => ctx.mates.has(x) && ctx.b.heat(x) >= 0.2 && (ctx.b.heat(x) < 0.5 || !cutOk(ctx)))) {
      out.push({
        key: `defend:${t}`, label: `${ctx.name(t)}をかばう(仲間)`, kind: 'defend', pers: 'defend', target: t, heat: ctx.b.heat(t),
        rule: 15 + ctx.b.heat(t) * 40 - 25 * (ctx.mem.spoken.get(`defend:${t}`) ?? 0), st: { kind: 'defend', target: t },
      });
    }
    return out;
  },
  onSpoke: fakeOnSpoke,
  targetOk(ctx, t, kind) {
    if (kind === 'accuse' || kind === 'agree') return !ctx.mates.has(t);
    if (kind === 'vote') return !ctx.mates.has(t) || (cutOk(ctx) && ctx.b.heat(t) >= ctx.f.v('matesCutHeat')); // 仲間が吊られそうなら切り捨て(身内切り)も
    return true;
  },
  bonus(ctx, c) {
    if ((c.kind === 'accuse' || c.kind === 'vote_intent') && c.target != null) {
      // 狂人(偽物確定)は吊りたくないので疑わない
      if (isKnownMadman(ctx, c.target)) return -25;
      // 妖狐らしい相手は吊って消したい(残すと人狼の勝ちが妖狐に奪われる)
      if (foxSuspects(ctx).has(c.target)) return 25;
      // 本物の占い師は吊りたいが、対抗COがいないときに占い師を疑うと自分が怪しまれる。対抗がいるときだけ押す
      // 本物かどうか確信が持てないCO(狂人かもしれない)は押さない
      const sl = seerLikely(ctx).get(c.target) ?? 0;
      if (pushSeerOk(ctx, c.target) && sl >= 0.75) return 20 * sl + ctx.b.seerPenalty(c.target);
    }
    return 0;
  },
  voteRule(ctx, t) {
    // 身内切り: どうせ吊られる仲間には自分も入れて、村人のふりを保つ
    if (ctx.mates.has(t)) return cutOk(ctx) ? 20 + 70 * ctx.b.heat(t) : 30;
    if (isKnownMadman(ctx, t)) return Math.max(5, ctx.b.susp[t] - 30);
    if (foxSuspects(ctx).has(t)) return ctx.b.susp[t] + 40;
    // 多数派に乗って目立たない。対抗COがいるときだけ本物の占い師を吊りに行く
    const sl = seerLikely(ctx).get(t) ?? 0;
    const push = pushSeerOk(ctx, t) && sl >= 0.75 ? 22 * sl : -ctx.b.seerPenalty(t);
    return ctx.b.susp[t] + push + 12 * ctx.b.heat(t);
  },
  wolfPlan(ctx) {
    if (ctx.day !== 0) return null;
    if ((ctx.obs.priv.wolfChat ?? []).some((m) => m.kind === 'plan')) return null;
    const all = [ctx.me, ...ctx.mates].sort((a, b) => a - b);
    if (all[0] !== ctx.me) return null; // 一番若い番号の人狼が作戦を決める
    // 既定の作戦: 騙りは確率で、囲いは3割、身内切りはあり(勝率で決めた値)
    return { fakeSeer: ctx.rng.chance(ctx.beh.wolfFakeProb) ? ctx.rng.pick(all) : null, kakoi: ctx.rng.chance(ctx.f.v('kakoiP')), cut: true };
  },
  // 襲撃先: 本物らしい占い師 > 狩人COした人 > 霊能者 > 共有者 > 村で信頼されている人
  //   狂人(偽物確定)と、自分たちの偽占いが黒を出した相手は襲わない(襲うと嘘が露呈する)
  nightCands(ctx, kind: NightKind) {
    if (kind !== 'attack') return [];
    const sl = seerLikely(ctx);
    // 自分たちの偽占い師が生きていて、他に偽物(狂人)のCOがいないとき、本物を襲うと
    // 「残った占い師=偽物」と見抜かれる。そのときは本物の襲撃を急がず、霊能者・共有者などを狙う
    const ourFakeAlive = [...ctx.b.seerClaims.keys()].some((c) => isWolfSide(ctx, c) && ctx.b.aliveNow[c]);
    const otherFake = [...ctx.b.seerClaims.keys()].some((c) => !isWolfSide(ctx, c) && ctx.b.aliveNow[c] && claimantRealness(ctx, c) === 0);
    const seerW = ctx.f.on('w_seer_hold') && ourFakeAlive && !otherFake ? ctx.f.v('seerHoldW') : ctx.f.v('seerAttackW');
    // 偽占い師が生きている間は、嘘を暴ける霊能者を最優先で消す(霊能噛み)
    const mediumW = ctx.f.on('w_medium_bite') && ourFakeAlive ? ctx.f.v('mediumBiteW') : 45;
    const all = ctx.others.filter((t) => !ctx.mates.has(t));
    // 狂人(偽物確定)と、自分たちの偽占いが黒を出した相手は候補から外す(他に誰もいなければ仕方なく含める)
    const foxes = foxSuspects(ctx);
    const noMad = all.filter((t) => !isKnownMadman(ctx, t));
    let pool = noMad.filter((t) => !foxes.has(t) && !(ctx.f.on('w_avoid_blacked') && blackedByUs(ctx, t)));
    if (!pool.length) pool = noMad; // 狂人以外に候補がなければ、黒先や妖狐疑いでも仕方なく襲う
    // 護衛成功が出た相手: 連続護衛ありなら今夜も守られている可能性が高いので避ける。
    // 連続護衛なしなら今夜は守れないので、むしろ狙い目(昨夜守られた=狩人が守りたい重要人物)
    const guarded = ctx.f.on('w_avoid_guarded') ? guardedTargets(ctx) : new Set<number>();
    const guardedMul = ctx.obs.config.noConsecutiveGuard ? 1.5 : ctx.f.v('guardedW');
    // 狩人CO(定員内)は最優先で噛む: 狩人は自分を護衛できないので確実に通り、以後の襲撃が護衛で止められなくなる
    const biteHunter = ctx.f.on('w_bite_hunter') && ctx.b.aliveHunterClaims() <= ctx.obs.config.roleCounts.hunter;
    // 灰噛みを続けない(定石): 昨夜の犠牲者が完全グレー(COも白もない)なら、今夜はグレー以外(役職CO・白先)を優先する
    const lastVictim = [...ctx.obs.events].reverse().find((e) => e.t === 'death');
    const isGrey = (t: number) => !ctx.b.hasClaimed(t) && ![...ctx.b.seerClaims.values()].some((c) => c.results.some((r) => r.target === t && r.color === 'white'));
    const greyAgain = ctx.f.on('w_grey_once') && lastVictim && lastVictim.t === 'death' && isGrey(lastVictim.target);
    return (pool.length ? pool : all).map((t) => {
      let rule = 100 * (sl.get(t) ?? 0) * seerW + (ctx.b.hunterClaims.has(t) ? ctx.f.v('hunterAttackW') : 0) + (ctx.b.mediumClaims.has(t) ? mediumW : 0) + (ctx.b.masonClaims.has(t) ? ctx.f.v('masonAttackW') : 0) + (100 - ctx.b.susp[t]) * ctx.f.v('trustAttackW');
      if (guarded.has(t)) rule *= guardedMul;
      if (greyAgain && isGrey(t)) rule *= 0.6;
      const must = biteHunter && ctx.b.hunterClaims.has(t) && !ctx.mates.has(t);
      return { key: `attack:${t}`, label: `${ctx.name(t)}を襲撃${must ? '(狩人COは必ず噛む)' : ''}`, kind: 'night' as const, pers: 'neutral' as const, target: t, heat: 0, rule, must };
    });
  },
  internal(ctx, chosen) {
    const sl = seerLikely(ctx);
    const top = [...sl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).filter((x) => x[1] > 0.1);
    const lines = [`仲間: ${[...ctx.mates].map(ctx.name).join('、') || 'なし'}`];
    if (top.length) lines.push(`本物の占い師の可能性: ${top.map(([t, p]) => `${ctx.name(t)} ${Math.round(p * 100)}%`).join(' / ')}`);
    const mad = ctx.others.filter((t) => isKnownMadman(ctx, t));
    if (mad.length) lines.push(`判定が真実と違う→狂人: ${mad.map(ctx.name).join('、')}`);
    const fx = [...foxSuspects(ctx)];
    if (fx.length) lines.push(`襲っても死なない→妖狐の疑い: ${fx.map(ctx.name).join('、')}`);
    if (fakeSeerId(ctx) === ctx.me) lines.push(ctx.mem.coDone ? '作戦: 自分が占い師を騙る(CO済み)' : otherSeerClaims(ctx).length >= 3 ? '作戦: 騙りは中止(COが多すぎる)' : '作戦: 自分が占い師を騙る(予定)');
    const pm = planMsg(ctx);
    if (pm) lines.push(`会議の取り決め: 囲い${pm.kakoi ? 'あり' : 'なし'}／身内切り${pm.cut ?? true ? 'あり' : 'なし'}`);
    lines.push(`表向き: ${chosen.label}`);
    return lines;
  },
};
