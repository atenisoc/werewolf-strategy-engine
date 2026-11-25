import type { RoleStrategy } from '../types';

const cw = (c: string) => (c === 'black' ? '黒' : '白');

export const medium: RoleStrategy = {
  init(m, { rng, beh }) {
    m.seerCoPlan = rng.chance(beh.mediumCoDay1Prob); // 結果が出る前(初日)にCOする方針か(フィールドを流用)
  },
  talkExtras(ctx) {
    const res = ctx.obs.priv.mediumResults ?? [];
    if (res.length === 0) {
      // 初日CO: 結果はまだないが、ローラーに巻き込まれないよう先に名乗る。2人目以降の霊能COが出ていれば対抗として必ず出る
      const others = [...ctx.b.mediumClaims.keys()].filter((c) => c !== ctx.me);
      // 吊り逃れCO: 自分に疑いが集まってきたら、結果がなくても名乗る(霊能を初日に吊られるのが村の最悪手)
      const pressed = ctx.b.accusersOfMe() >= 2 || ctx.b.heat(ctx.me) >= 0.25;
      // 黒伏せ(定石): 占いの黒が出ている日は、役職を噛みから守るため霊能は潜伏して翌朝の結果と一緒に出る。
      // 例外: 黒を出された人が役職COした(真偽を急ぐ)、対抗の霊能COが出た、自分が疑われている
      const blackOut = ctx.f.on('m_black_hide') && [...ctx.b.seerClaims.values()].some((c) => c.results.some((r) => r.color === 'black' && ctx.b.aliveNow[r.target] && !ctx.b.hasClaimed(r.target)));
      // 初日は占い師のCOを待ってから(第1ラウンドは挨拶だけ)。占い結果を見て、白進行ならCO・黒が出ていれば潜伏
      const waitSeers = ctx.f.on('m_black_hide') && ctx.day === 1 && ctx.round === 0 && ctx.rounds > 1;
      if (!ctx.mem.coDone && ctx.day >= 1 && ((ctx.mem.seerCoPlan && !blackOut && !waitSeers) || others.length > 0 || pressed)) {
        // 対抗の霊能CO(偽物)が出たら必ず名乗る(偽霊能を放置すると真偽の判定が遅れる)
        return [{ key: 'co', label: pressed ? '霊能者CO(疑われたので名乗る)' : others.length ? '霊能者CO(対抗)' : '霊能者CO(結果なし)', kind: 'co', pers: 'neutral', heat: 0, rule: others.length || pressed ? 95 : 80, must: pressed || others.length > 0, st: { kind: 'co', claim: 'medium' } }];
      }
      return [];
    }
    // 未報告の結果は古い順に必ず言う
    const r = ctx.mem.coDone ? res[Math.min(ctx.mem.reportedMedium, res.length - 1)] : res[res.length - 1];
    if (!ctx.mem.coDone) {
      return [{
        key: 'co', label: `霊能者CO(${ctx.name(r.target)}=${cw(r.color)})`, kind: 'co', pers: 'neutral', heat: 0, rule: 94, must: ctx.day >= 2,
        st: { kind: 'co', claim: 'medium', target: r.target, color: r.color },
      }];
    }
    if (res.length > ctx.mem.reportedMedium) {
      return [{
        key: 'result', label: `霊能結果を報告(${ctx.name(r.target)}=${cw(r.color)})`, kind: 'result', pers: 'neutral', heat: 0, rule: 97, must: true,
        st: { kind: 'result', claim: 'medium', target: r.target, color: r.color },
      }];
    }
    return [];
  },
  onSpoke(ctx, c) {
    if (c.kind === 'co') {
      ctx.mem.coDone = true;
      ctx.mem.reportedMedium = (ctx.obs.priv.mediumResults ?? []).length;
    } else if (c.kind === 'result') ctx.mem.reportedMedium += 1;
  },
};
