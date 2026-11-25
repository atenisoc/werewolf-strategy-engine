import type { RoleStrategy } from '../types';

// 妖狐: 第三陣営。目立たず生き残ることが目的。
//   - 自分からは疑わない(占い師の目を引かない)。多数派に乗って票を合わせる
//   - COはしない。人狼に噛まれても死なないので、「平和な朝」の原因が自分だと知っている
export const fox: RoleStrategy = {
  bonus(ctx, c) {
    if (c.kind === 'accuse' || c.kind === 'vote_intent') return -12 + 10 * c.heat; // 自分から言い出さない。乗るだけ
    if (c.kind === 'agree') return 8;
    if (c.kind === 'wait') return 8;
    if (c.kind === 'ask_co') return -30; // 占い師に動いてほしくない
    return 0;
  },
  voteRule(ctx, t) {
    // 多数派に合わせて目立たない。占い師COは生きていてほしくない(呪殺される)ので少し上げる
    return ctx.b.susp[t] * 0.6 + 30 * ctx.b.heat(t) + (ctx.b.seerClaims.has(t) ? 10 : 0);
  },
  internal(ctx, chosen) {
    return ['自分は妖狐(人狼に噛まれても死なない。占われると死ぬ)', `表向き: ${chosen.label}`];
  },
};
