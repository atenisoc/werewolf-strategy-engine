import type { Color } from '../../game/types';
import type { Cand, Ctx } from '../types';

// 占い師/霊能者を騙る(偽CO)人狼/狂人の共通ロジック。
// 「本当は何も占っていない」ので、結果は"表向きの発言"としてここで作る。

// 自分以外(人狼なら仲間も除く)の占い師CO
export function otherSeerClaims(ctx: Ctx): number[] {
  return [...ctx.b.seerClaims.keys()].filter((c) => c !== ctx.me && !(ctx.role === 'werewolf' && ctx.mates.has(c)));
}

function genFakeSeer(ctx: Ctx, mode: 'wolf' | 'mad', realSeer: number | null) {
  const f = ctx.mem.fake;
  const done = new Set(f.results.map((r) => r.target));
  // 役職COしている人は占わない(本物と同じセオリー。共有者COに黒を出すとすぐ嘘が露呈し、霊能・狩人COに白を出しても無駄打ちで怪しまれる)
  const grey = ctx.others.filter((t) => !done.has(t) && !ctx.b.hasClaimed(t));
  const cand = grey.length ? grey : ctx.others.filter((t) => !done.has(t) && !ctx.b.masonClaims.has(t));
  if (!cand.length) return;
  const nonMates = cand.filter((t) => !ctx.mates.has(t));
  let target: number;
  let color: Color;
  // 霊能者が生きているうちに黒を出すと、黒先が吊られた翌日に「白でした」で嘘が露呈する。
  // 黒を出すのは、霊能者がいない編成か、霊能者COが全員死んだあと(または初日に出ていない霊能を狙う2日目以降)に限る
  const mediumAlive = [...ctx.b.mediumClaims.keys()].some((m) => ctx.b.aliveNow[m]);
  const mediumPossible = ctx.obs.config.roleCounts.medium > 0 && (mediumAlive || (ctx.b.mediumClaims.size === 0 && ctx.day <= 2));
  const blackOk = !ctx.f.on('w_no_black_medium') || (!mediumPossible && ctx.day >= 2);
  if (nonMates.length && blackOk && ctx.rng.chance(mode === 'wolf' ? ctx.f.v('fakeBlackP') : 0.5)) {
    color = 'black';
    // 人狼: 本物の占い師がわかっていれば、本物に黒を出して先に吊らせる(対抗黒)ことも
    // (対抗黒は役職CO者を占わないセオリーの例外。本物の占い師を先に吊らせるための意図的な手)
    if (mode === 'wolf' && ctx.f.on('w_counter_black') && realSeer != null && !done.has(realSeer) && !ctx.mates.has(realSeer) && ctx.b.aliveNow[realSeer] && ctx.rng.chance(ctx.f.v('counterBlackP'))) target = realSeer;
    else {
      // 黒: 周りから一番疑われている(=信じてもらいやすい)非仲間に出す。仲間には絶対に黒を出さない
      const pool = nonMates.filter((t) => !ctx.b.seerClaims.has(t));
      target = [...(pool.length ? pool : nonMates)].sort((a, b) => ctx.b.susp[b] - ctx.b.susp[a])[0];
    }
  } else {
    const mm = cand.filter((t) => ctx.mates.has(t));
    // 囲い(仲間に白を出す)は作戦会議で決めたときだけ。初回の白で囲うことが多い
    const kakoi = mode === 'wolf' && mm.length && (ctx.obs.priv.wolfChat ?? []).some((m) => m.kind === 'plan' && m.kakoi) && ctx.rng.chance(ctx.f.v('mateWhiteP'));
    target = kakoi ? ctx.rng.pick(mm) : ctx.rng.pick(cand.filter((t) => !ctx.mates.has(t)).length ? cand.filter((t) => !ctx.mates.has(t)) : cand);
    color = 'white';
  }
  f.results.push({ day: ctx.day, target, color });
  f.genDay = ctx.day;
}

// 偽の霊能結果: 処刑された占い師COは「白」(本物を吊ったと思わせる)、それ以外は疑惑度で決める
function genFakeMedium(ctx: Ctx) {
  const f = ctx.mem.fake;
  const done = new Set(f.results.map((r) => r.target));
  for (const ev of ctx.obs.events) {
    if (ev.t !== 'execute' || done.has(ev.target)) continue;
    let color: Color;
    if (ctx.mates.has(ev.target)) color = 'white'; // 仲間(人狼)が吊られても白と言い張る
    else if (ctx.b.seerClaims.has(ev.target)) color = 'white';
    else color = ctx.b.susp[ev.target] >= 45 ? 'black' : 'white';
    f.results.push({ day: ctx.day, target: ev.target, color });
    done.add(ev.target);
  }
  f.genDay = ctx.day;
}

export function fakeSeerExtras(ctx: Ctx, mode: 'wolf' | 'mad', wantFake: boolean, realSeer: number | null = null): Cand[] {
  if (!wantFake || ctx.day < 1) return [];
  const f = ctx.mem.fake;
  if (f.claim === 'medium') return fakeMediumExtras(ctx, mode);
  // すでに自分以外に2人以上の占い師COがいるなら、3人目として出ても吊られるだけ。騙りをやめて潜伏する
  if (ctx.f.on('w_co_limit') && !ctx.mem.coDone && otherSeerClaims(ctx).length >= 3) {
    if (!ctx.dry) f.plan = false;
    return [];
  }
  if (!ctx.dry && f.genDay < ctx.day) genFakeSeer(ctx, mode, realSeer);
  const out: Cand[] = [];
  // CO時は最新の結果、CO後は未報告の結果を古い順に(本物と同じく、結果を言わない騙りは不自然)
  const r = ctx.mem.coDone ? f.results[Math.min(f.reported, f.results.length - 1)] : f.results[f.results.length - 1];
  if (!r) return out;
  if (!ctx.mem.coDone) {
    out.push({
      key: 'co', label: `占い師を騙ってCO(${ctx.name(r.target)}=${r.color === 'black' ? '黒' : '白'})`, kind: 'co', pers: 'neutral', heat: 0,
      rule: mode === 'wolf' ? 92 : 86, st: { kind: 'co', claim: 'seer', target: r.target, color: r.color },
    });
  } else if (f.reported < f.results.length) {
    out.push({
      key: 'result', label: `偽の占い結果を報告(${ctx.name(r.target)}=${r.color === 'black' ? '黒' : '白'})`, kind: 'result', pers: 'neutral', heat: 0,
      rule: 96, must: true, st: { kind: 'result', claim: 'seer', target: r.target, color: r.color },
    });
  }
  return out;
}

function fakeMediumExtras(ctx: Ctx, mode: 'wolf' | 'mad'): Cand[] {
  const f = ctx.mem.fake;
  if (!ctx.obs.events.some((e) => e.t === 'execute')) return [];
  // 本物の霊能者がまだ出ていないうちに出る(霊能COが2人以上なら出ない)
  const others = [...ctx.b.mediumClaims.keys()].filter((c) => c !== ctx.me);
  if (!ctx.mem.coDone && others.length >= 2) {
    if (!ctx.dry) f.plan = false;
    return [];
  }
  if (!ctx.dry && f.genDay < ctx.day) genFakeMedium(ctx);
  const r = ctx.mem.coDone ? f.results[Math.min(f.reported, f.results.length - 1)] : f.results[f.results.length - 1];
  if (!r) return [];
  const cw = r.color === 'black' ? '黒' : '白';
  if (!ctx.mem.coDone) {
    return [{ key: 'co', label: `霊能者を騙ってCO(${ctx.name(r.target)}=${cw})`, kind: 'co', pers: 'neutral', heat: 0, rule: mode === 'wolf' ? 90 : 86, st: { kind: 'co', claim: 'medium', target: r.target, color: r.color } }];
  }
  if (f.reported < f.results.length) {
    return [{ key: 'result', label: `偽の霊能結果を報告(${ctx.name(r.target)}=${cw})`, kind: 'result', pers: 'neutral', heat: 0, rule: 96, must: true, st: { kind: 'result', claim: 'medium', target: r.target, color: r.color } }];
  }
  return [];
}

export function fakeOnSpoke(ctx: Ctx, c: Cand) {
  const claim = c.st?.claim;
  if (claim !== 'seer' && claim !== 'medium') return;
  if (c.kind === 'co') {
    ctx.mem.coDone = true;
    ctx.mem.fake.reported = ctx.mem.fake.results.length;
  } else if (c.kind === 'result') ctx.mem.fake.reported += 1;
}
