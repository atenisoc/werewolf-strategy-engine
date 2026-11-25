import type { Color, ReasonKey } from '../game/types';
import type { Cand, Ctx } from './types';

// 「視点の整合性」レイヤー。
// 役職をCOした人(本物でも騙りでも)は、自分が公開した判定と矛盾する行動を取らない:
//  ・自分が白を出した人を疑わない・吊らない(対抗の黒が出ていても。対抗は自分の視点では偽物)
//  ・自分が黒を出した人は吊りに行く(根拠は「私の占いで黒」)
//  ・同じ役職を名乗る対抗は偽物として扱う(かばわない。根拠は「本物は私」)。対抗の判定を根拠に使わない
//  ・自分も含まれる「占い師ローラー」は提案しない
// 本物の占い師は belief 側でも同じ結論になるが、騙り(人狼・狂人)は内心が別なので、ここで表の行動を揃える。

export interface MyView {
  claim: 'seer' | 'medium' | 'hunter' | null;
  said: Map<number, Color>; // 自分が公開した占い判定(占い師COのとき)
  rivals: number[]; // 生きている同役職の対抗CO
}

export function myView(ctx: Ctx): MyView {
  let claim: MyView['claim'] = null;
  const said = new Map<number, Color>();
  for (const e of ctx.obs.events) {
    if (e.t !== 'say' || e.by !== ctx.me) continue;
    const st = e.st;
    if ((st.kind === 'co' || st.kind === 'result') && (st.claim === 'seer' || st.claim === 'medium' || st.claim === 'hunter')) {
      claim = st.claim;
      if (st.claim === 'seer' && st.target != null && st.color) said.set(st.target, st.color);
    }
  }
  const pool = claim === 'seer' ? ctx.b.seerClaims.keys() : claim === 'medium' ? ctx.b.mediumClaims.keys() : claim === 'hunter' ? ctx.b.hunterClaims : [];
  const rivals = [...pool].filter((c) => c !== ctx.me && ctx.b.aliveNow[c] && !ctx.mates.has(c));
  return { claim, said, rivals };
}

const HOSTILE = new Set(['accuse', 'agree', 'vote_intent', 'vote', 'silent_point', 'waver', 'vote_review', 'medium_review']);
const CONTRA = 200; // 矛盾する候補の減点。矛盾しない候補が1つでもあれば矛盾候補は外す(投票でほかに入れる人がいないときだけ残る)

export function applyViewpoint(ctx: Ctx, cands: Cand[], mode: 'talk' | 'vote'): Cand[] {
  if (!ctx.f.on('a_viewpoint')) return cands;
  const v = myView(ctx);
  if (!v.claim) return cands;
  const out: Cand[] = [];
  const contra = new Set<string>();
  let hitsOwnBlack = false;
  for (const c0 of cands) {
    let c = c0;
    const t = c.target;
    const st = c.st;
    const hostile = c.pers === 'accuse' || HOSTILE.has(c.kind) || (c.kind === 'co_timing' && st?.tag === 'late') || (c.kind === 'bite_logic' && st?.color === 'black');
    const defend = (c.pers === 'defend' && c.kind !== 'defend_self') || c.kind === 'defend' || c.kind === 'disagree' || (c.kind === 'co_timing' && st?.tag === 'early');
    const fix = (d: number, note: string, reason?: ReasonKey | null) => {
      const nst = st && reason !== undefined ? { ...st, reason: reason ?? undefined } : st;
      c = { ...c, rule: c.rule + d, label: `${c.label}(${note})`, st: nst };
      if (d <= -CONTRA) contra.add(c.key);
    };
    if (t != null && t !== ctx.me) {
      const mine = v.said.get(t);
      if (mine === 'white' && hostile) fix(-CONTRA, '自分が白を出した相手。矛盾');
      if (mine === 'black' && defend) fix(-CONTRA, '自分が黒を出した相手。矛盾');
      // 黒を出した以上、吊りに行くのが筋(多数派が別を見ていても自分の黒を推す)
      if (mine === 'black' && hostile) {
        fix(mode === 'vote' ? +55 : +35, '自分の黒', 'self_black');
        hitsOwnBlack = true;
        // 投票は必ず自分の黒へ(例外: 多数派が対抗COを吊ろうとしているときは、そちらに乗ってもよい)
        if (mode === 'vote' && !v.rivals.some((r) => ctx.b.heat(r) >= 0.5)) c = { ...c, must: true };
      }
      if (v.rivals.includes(t)) {
        if (defend) fix(-CONTRA, '対抗は自分の視点では偽物。かばわない');
        else if (hostile && (!st?.reason || st.reason === 'seer_black' || st.reason === 'counter_co' || st.reason === 'fake_seer')) fix(+15, '対抗は偽物', 'rival_claim');
      }
      // 対抗の判定を根拠にしない(自分が本物なら対抗の黒は意味を持たない)
      if (st?.reason === 'seer_black' && v.claim === 'seer' && mine !== 'black') fix(0, '対抗の黒は根拠にしない', null);
      // 対抗の疑いに「賛成」もしない
      if (c.kind === 'agree' && st?.ref != null && v.rivals.includes(st.ref)) fix(-CONTRA, '対抗の意見には乗らない');
    }
    // ライン指摘は ref も疑いの対象(自分の白を「仲間」扱いしない)
    if (c.kind === 'line' && st?.ref != null && v.said.get(st.ref) === 'white') fix(-CONTRA, '自分が白を出した相手をラインに含めない');
    if (c.kind === 'propose' && st?.plan) {
      if (v.claim === 'seer' && st.plan === 'roller') fix(-CONTRA, '自分が含まれるローラーは提案しない');
      if (v.claim === 'medium' && st.plan === 'medium_roller') fix(-CONTRA, '自分が含まれるローラーは提案しない');
      if (v.claim === 'seer' && st.plan === 'black' && st.target != null && v.said.get(st.target) !== 'black') fix(-CONTRA, '対抗の黒先吊りには乗らない');
    }
    out.push(c);
  }
  // 矛盾しない候補が残るなら、矛盾候補は候補から外す(乱数・性格で選ばれないように)
  if (contra.size && out.some((c) => !contra.has(c.key))) {
    const kept = out.filter((c) => !contra.has(c.key));
    out.length = 0;
    out.push(...kept);
  }
  // 自分の黒が生きているのに、それを疑う候補がなければ足す(黒を出した以上、吊りに行くのが筋)
  if (mode === 'talk' && !hitsOwnBlack) {
    for (const [t, col] of v.said) {
      if (col !== 'black' || !ctx.b.aliveNow[t] || ctx.mates.has(t)) continue;
      const n = ctx.mem.spoken.get(`accuse:${t}`) ?? 0;
      out.push({ key: `accuse:${t}`, label: `${ctx.name(t)}を疑う(自分の黒)`, kind: 'accuse', pers: 'accuse', target: t, heat: ctx.b.heat(t), rule: 72 - 30 * n, st: { kind: 'accuse', target: t, reason: 'self_black' } });
      break;
    }
  }
  return out;
}
