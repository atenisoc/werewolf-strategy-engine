import type { Cand, NightKind, RoleStrategy } from '../types';

export const hunter: RoleStrategy = {
  // 狩人は基本隠れる。2人以上から疑われたときだけ身を守るためにCO。
  // 占い師COを守って護衛成功したときは、名乗り出て報告する(その占い師の信用を上げる。自分は噛まれやすくなる)
  talkExtras(ctx) {
    const out: Cand[] = [];
    const last = (ctx.obs.priv.guardLog ?? []).slice(-1)[0];
    const peaceToday = ctx.obs.events.some((e) => e.t === 'peace' && e.day === ctx.day);
    // 既に狩人COしているなら、平和な朝は必ず護衛先を報告する(村が「平和な朝と報告が一致」の判定チェックをできるようにする)
    if (ctx.mem.gjReportedDay !== ctx.day && last && last.day === ctx.day - 1 && peaceToday && ctx.b.aliveNow[last.target] && (ctx.mem.coDone || ctx.b.seerClaims.has(last.target))) {
      out.push({ key: 'gj', label: `護衛成功を報告(${ctx.name(last.target)}を守った)`, kind: 'result', pers: 'neutral', heat: 0, rule: ctx.mem.coDone ? 96 : ctx.f.v('gjReportRule'), must: !!ctx.mem.coDone, st: { kind: 'result', claim: 'hunter', target: last.target } });
    }
    // 吊り逃れCO: 疑いが集まったら名乗る(狩人は吊られるより噛まれたほうが村の得。ただし名乗ると以後は護衛先を読まれやすい)
    if (!ctx.mem.coDone && (ctx.b.accusersOfMe() >= 2 || ctx.b.heat(ctx.me) >= 0.3)) out.push({ key: 'co', label: '狩人CO(身を守る)', kind: 'co', pers: 'neutral', heat: 0, rule: 88, must: ctx.b.heat(ctx.me) >= 0.3, st: { kind: 'co', claim: 'hunter' } });
    // 対抗CO: 他に狩人COが出たら必ず名乗る(偽物を本物扱いさせない。定員超過で「どちらかが人外」になる)
    if (!ctx.mem.coDone && [...ctx.b.hunterClaims].some((h) => h !== ctx.me && ctx.b.aliveNow[h])) out.push({ key: 'co', label: '狩人CO(対抗)', kind: 'co', pers: 'neutral', heat: 0, rule: 96, must: true, st: { kind: 'co', claim: 'hunter' } });
    return out;
  },
  onSpoke(ctx, c) {
    if (c.kind === 'co') ctx.mem.coDone = true;
    if (c.kind === 'result') {
      ctx.mem.coDone = true;
      ctx.mem.gjReportedDay = ctx.day;
    }
  },
  // 護衛先: 本物らしい占い師 > 霊能者 > 共有者 > 信頼できる人 (偽物らしい占い師は守らない)
  nightCands(ctx, kind: NightKind): Cand[] {
    if (kind !== 'guard') return [];
    const last = (ctx.obs.priv.guardLog ?? []).slice(-1)[0]?.target;
    return ctx.others.filter((t) => !(ctx.obs.config.noConsecutiveGuard && t === last)).map((t) => ({
      key: `guard:${t}`, label: `${ctx.name(t)}を護衛`, kind: 'night' as const, pers: 'neutral' as const, target: t, heat: 0,
      rule: ctx.b.seerTrust(t) * 90 + (ctx.b.mediumClaims.has(t) ? 35 : 0) + (ctx.b.masonClaims.has(t) ? 18 : 0) + 20 + (100 - ctx.b.susp[t]) * 0.2 - (ctx.b.seerClaims.has(t) && ctx.b.seerTrust(t) < 0.2 ? 30 : 0),
    }));
  },
};
