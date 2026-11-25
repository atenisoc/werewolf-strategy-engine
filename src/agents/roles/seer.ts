import type { Cand, NightKind, RoleStrategy } from '../types';

const cw = (c: string) => (c === 'black' ? '黒' : '白');

export const seer: RoleStrategy = {
  init(m, { rng, beh }) {
    m.seerCoPlan = rng.chance(beh.seerCoProb);
  },
  talkExtras(ctx) {
    const res = ctx.obs.priv.seerResults ?? [];
    const out: Cand[] = [];
    if (!ctx.mem.coDone) {
      if (ctx.mem.seerCoPlan && ctx.day >= 1) {
        const r = res[res.length - 1];
        out.push({
          key: 'co', label: `占い師CO${r ? `(${ctx.name(r.target)}=${cw(r.color)})` : ''}`, kind: 'co', pers: 'neutral', heat: 0, rule: r ? 96 : 70, must: !!r && ctx.day >= 2,
          st: r ? { kind: 'co', claim: 'seer', target: r.target, color: r.color } : { kind: 'co', claim: 'seer' },
        });
      }
    } else if (res.length > ctx.mem.reportedSeer) {
      // 未報告の結果は古い順に必ず言う(言わない占い師は不自然で、黒結果が埋もれると村が負ける)
      const r = res[ctx.mem.reportedSeer];
      out.push({
        key: 'result', label: `占い結果を報告(${ctx.name(r.target)}=${cw(r.color)})`, kind: 'result', pers: 'neutral', heat: 0, rule: 98, must: true,
        st: { kind: 'result', claim: 'seer', target: r.target, color: r.color, why: ctx.mem.whyOf[r.target] },
      });
    }
    return out;
  },
  onSpoke(ctx, c) {
    if (c.kind === 'co' && c.st?.claim === 'seer') {
      ctx.mem.coDone = true;
      ctx.mem.reportedSeer = (ctx.obs.priv.seerResults ?? []).length;
    } else if (c.kind === 'result') ctx.mem.reportedSeer += 1;
  },
  // 占い先: まだ白黒がはっきりしていない人(疑惑度が中間の人)ほど価値が高い
  nightCands(ctx, kind: NightKind) {
    if (kind !== 'divine') return [];
    const done = new Set((ctx.obs.priv.seerResults ?? []).map((r) => r.target));
    // セオリー: 占い先はグレー(役職COしていない人)から。霊能・狩人・共有者COは結果が出ても村の判断が変わりにくく、
    // 対抗の占いCOは白黒どちらでも信じてもらえないので、占うのは最後(グレーが尽きたとき)
    const grey = ctx.others.filter((t) => !done.has(t) && !ctx.b.hasClaimed(t));
    const pool = grey.length ? grey : ctx.others.filter((t) => !done.has(t));
    return pool
      .map((t) => ({
        key: `divine:${t}`, label: `${ctx.name(t)}を占う`, kind: 'night' as const, pers: 'neutral' as const, target: t, heat: 0,
        // 対抗の占い師COは割り引き(白黒どちらでも村は信じにくい)。共有者CO(確定白)は占う価値なし。議論の中心人物は価値が高い
        rule: 100 - Math.abs(ctx.b.susp[t] - 50) * 1.2 - (ctx.b.seerClaims.has(t) ? 25 : 0) - (ctx.b.isConfirmedWhite(t) ? 60 : 0) + ctx.b.heat(t) * 15
          // 定石: 対抗の占い師が白を出した人を優先(黒なら対抗の囲いが露呈し、対抗を偽物と示せる)
          + (ctx.f.on('s_divine_rival_white') && [...ctx.b.seerClaims.values()].some((c) => c.by !== ctx.me && ctx.b.aliveNow[c.by] && c.results.some((r) => r.target === t && r.color === 'white')) ? 20 : 0)
          // 妖狐がいる村: 白く見えて目立たない人ほど妖狐の可能性があるので、占って呪殺を狙う(狐探し)
          + (ctx.obs.config.roleCounts.fox > 0 && !ctx.b.seerClaims.has(t) ? Math.max(0, 50 - ctx.b.susp[t]) * ctx.f.v('foxHuntW') : 0),
      }));
  },
};
