import type { RoleStrategy } from '../types';
import { fakeOnSpoke, fakeSeerExtras } from './fake';

// 狂人: 誰が人狼かは知らない。占い師(または霊能者)を騙って村を混乱させる。
export const madman: RoleStrategy = {
  init(m, { rng, beh }) {
    if (rng.chance(beh.madFakeProb)) m.fake = { ...m.fake, plan: true, claim: 'seer' };
    else if (!(beh.off ?? []).includes('m_fake_medium') && rng.chance(beh.madFakeMediumProb)) m.fake = { ...m.fake, plan: true, claim: 'medium' };
  },
  talkExtras(ctx) {
    return fakeSeerExtras(ctx, 'mad', ctx.mem.fake.plan);
  },
  onSpoke: fakeOnSpoke,
  // 本物らしい(他の)占い師を疑って吊りたい
  bonus(ctx, c) {
    if ((c.kind === 'accuse' || c.kind === 'vote_intent') && c.target != null && ctx.b.seerClaims.has(c.target)) return 15;
    return 0;
  },
  voteRule(ctx, t) {
    return ctx.b.susp[t] + (ctx.b.seerClaims.has(t) ? 15 : 0);
  },
  internal(ctx, chosen) {
    const f = ctx.mem.fake;
    return [`自分は狂人(人狼の仲間が誰かは知らない)`, f.plan ? `${f.claim === 'medium' ? '霊能者' : '占い師'}を騙る方針` : `騙らず村人のふり`, `表向き: ${chosen.label}`];
  },
};
