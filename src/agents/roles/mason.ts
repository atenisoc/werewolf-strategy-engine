import type { Cand, RoleStrategy } from '../types';

// 共有者: 相方が確定で白いと知っている。2人でCOして「確定白」として議論を引っ張る。
export const mason: RoleStrategy = {
  init(m, { rng, beh }) {
    m.seerCoPlan = rng.chance(beh.masonCoProb); // 共有者CO方針(フィールドを流用)
  },
  talkExtras(ctx) {
    const out: Cand[] = [];
    if (!ctx.mem.coDone && ctx.day >= 1) {
      // 相方が先にCOしていれば必ず続く(2人揃ってこそ価値がある)
      const mateCoed = [...ctx.mates].some((m) => ctx.b.masonClaims.has(m));
      if (ctx.mem.seerCoPlan || mateCoed) out.push({ key: 'co', label: '共有者CO', kind: 'co', pers: 'neutral', heat: 0, rule: mateCoed ? 97 : 88, st: { kind: 'co', claim: 'mason' } });
    }
    return out;
  },
  onSpoke(ctx, c) {
    if (c.kind === 'co') ctx.mem.coDone = true;
  },
  // 相方は疑わない・投票しない
  targetOk(ctx, t, kind) {
    if (kind === 'defend') return true;
    return !ctx.mates.has(t);
  },
  internal(ctx, chosen) {
    return [`相方の共有者: ${[...ctx.mates].map(ctx.name).join('、') || 'なし'}`, `表向き: ${chosen.label}`];
  },
};
