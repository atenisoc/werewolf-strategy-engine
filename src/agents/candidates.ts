import type { Cand, Ctx, RoleStrategy } from './types';

// 全役職共通の発言候補。役職ごとの追加分(CO・結果報告など)は strategy.talkExtras で足す。
export function baseTalkCands(ctx: Ctx, strat: RoleStrategy): Cand[] {
  const { b, me, others, day, round, rounds, mem } = ctx;
  const out: Cand[] = [];
  // 同じ日に「かばった人を疑う」「疑った人をかばう」と向きを変えない(新しい強い根拠が出たときだけ例外)
  const defendedToday = new Set<number>();
  const accusedToday = new Set<number>();
  for (const e of ctx.obs.events) {
    if (e.t !== 'say' || e.day !== day || e.by !== me || e.st.target == null) continue;
    const k = e.st.kind;
    if (k === 'defend' || (k === 'co_timing' && e.st.tag === 'early') || (k === 'bite_logic' && e.st.color === 'white')) defendedToday.add(e.st.target);
    if (k === 'accuse' || k === 'vote_intent' || k === 'agree' || k === 'silent_point' || k === 'waver' || k === 'vote_review' || k === 'medium_review' || (k === 'co_timing' && e.st.tag === 'late') || (k === 'bite_logic' && e.st.color === 'black')) accusedToday.add(e.st.target);
  }
  const strongNow = (t: number) => ['seer_black', 'broken', 'fake_confirmed', 'self_black', 'rival_claim'].includes(b.publicReason(t) ?? '');
  const ok = (t: number, k: 'accuse' | 'defend' | 'vote' | 'agree') => {
    if (strat.targetOk?.(ctx, t, k) === false) return false;
    if ((k === 'accuse' || k === 'agree' || k === 'vote') && defendedToday.has(t) && !strongNow(t)) return false;
    if (k === 'defend' && accusedToday.has(t)) return false;
    return true;
  };
  const times = (key: string) => mem.spoken.get(key) ?? 0;
  // 会話系候補の強さ。最終ラウンドは投票宣言(票をまとめる発言)を優先させるため弱める
  const cw = ctx.f.v('convW') * (round >= rounds - 1 ? 0.5 : 1);
  const cwA = ctx.f.v('convW'); // 名指しを伴う会話(ブレ・沈黙・噛み筋の黒)は最終ラウンドでも弱めない
  const saysToday = ctx.obs.events.filter((e): e is Extract<typeof e, { t: 'say' }> => e.t === 'say' && e.day === day);
  const saidKind = (k: string, target?: number) => saysToday.some((e) => e.st.kind === k && (target == null || e.st.target === target));
  // 今日、指名して意見を求められたか(求められていたら「聞かれたので答える」形で疑いを言う)
  const askEv = ctx.obs.events.find((e) => e.t === 'say' && e.day === day && e.st.kind === 'ask' && e.st.target === me && !ctx.obs.events.some((x) => x.t === 'say' && x.day === day && x.by === me && x.st.tag === 'answer'));
  const askedBy: number | null = askEv && askEv.t === 'say' ? askEv.by : null;
  // 疑う順位 = 疑惑度 − 本物らしい占い師への減点(占い師を軽々しく吊り候補にしない)
  const rankScore = (t: number) => b.susp[t] - b.rolePenalty(t) + (ctx.role === 'werewolf' || ctx.role === 'madman' || ctx.role === 'fox' ? 0 : b.foxPressure(t));
  const bySusp = [...others].sort((a, c) => rankScore(c) - rankScore(a));

  // 疑う: 順位の高い上位3人
  for (const t of bySusp.filter((x) => ok(x, 'accuse')).slice(0, 3)) {
    let rule = rankScore(t) * 0.95 + b.heat(t) * 12;
    if (b.stance.get(t) === me) rule += 12; // 自分を疑っている相手への反撃
    rule -= 30 * times(`accuse:${t}`);
    out.push({
      key: `accuse:${t}`, label: `${ctx.name(t)}を疑う${askedBy != null ? '(聞かれたので答える)' : ''}`, kind: 'accuse', pers: 'accuse', target: t, rule: rule + (askedBy != null ? 10 : 0), heat: b.heat(t),
      // 言い方の強さ: 疑惑度が低いうちは柔らかく、黒判定・破綻などの強い根拠か高い疑惑のときだけ強く(初日の第一声で「人狼のそれ」とは言わない)
      st: { kind: 'accuse', target: t, ref: askedBy ?? undefined, reason: b.publicReason(t) ?? (b.heat(t) >= 0.4 ? 'follow' : undefined), tag: askedBy != null ? 'answer' : (strongNow(t) && b.susp[t] >= 58) || b.susp[t] >= 72 ? 'hard' : b.susp[t] < 50 || (day === 1 && round === 0) ? 'mild' : undefined },
    });
  }
  // かばう: 周りに疑われているが、自分は疑っていない人
  for (const t of others.filter((x) => ok(x, 'defend') && b.heat(x) >= 0.2 && b.susp[x] < 35).slice(0, 2)) {
    const rule = (100 - b.susp[t]) * 0.55 + b.heat(t) * 35 - 25 * times(`defend:${t}`);
    out.push({ key: `defend:${t}`, label: `${ctx.name(t)}をかばう`, kind: 'defend', pers: 'defend', target: t, rule, heat: b.heat(t), st: { kind: 'defend', target: t } });
  }
  // 賛成: 直近の誰かの疑いに乗る
  const la = b.lastAccuse;
  if (la && la.by !== me && la.target !== me && b.aliveNow[la.by] && b.aliveNow[la.target] && ok(la.target, 'agree')) {
    // 信頼できる人(確定白など)の疑いには乗りやすい
    const rule = b.susp[la.target] * 0.75 + 5 + (b.isConfirmedWhite(la.by) ? 14 : b.susp[la.by] < 40 ? 8 : 0) - 30 * times(`agree:${la.target}`);
    out.push({
      key: `agree:${la.target}`, label: `${ctx.name(la.by)}の${ctx.name(la.target)}への疑いに賛成`, kind: 'agree', pers: 'agree', target: la.target, rule, heat: b.heat(la.target),
      st: { kind: 'agree', target: la.target, ref: la.by },
    });
  }
  // 弁護・反論: 今日自分を疑った人がいれば、一度は言い返す(人は疑われて黙らない)
  const accusers = [...(b.stanceOn(day)?.entries() ?? [])].filter(([p, t]) => t === me && p !== me && b.aliveNow[p]).map(([p]) => p);
  if (accusers.length && !saysToday.some((e) => e.by === me && e.st.kind === 'defend_self')) {
    const a = accusers[accusers.length - 1];
    const myVotes = ctx.obs.events.filter((e) => e.t === 'vote' && e.by === me && e.day === day - 1);
    const myWhites = ctx.obs.events.filter((e) => e.t === 'say' && e.by === me && (e.st.kind === 'co' || e.st.kind === 'result') && e.st.claim === 'seer' && e.st.color === 'white');
    const tag = myWhites.length ? 'white' : myVotes.length ? 'vote_hist' : 'ask_back';
    out.push({ key: `defend_self:${a}`, label: `${ctx.name(a)}に反論する`, kind: 'defend_self', pers: 'defend', target: a, heat: b.heat(a), rule: (36 + b.heat(me) * 40 - 40 * times('defend_self')) * cwA, st: { kind: 'defend_self', target: a, tag } });
  }
  // 反対: 直近の誰かの疑いが、自分の見立て(白寄り)と違うときは異を唱える
  if (la && la.by !== me && la.target !== me && b.aliveNow[la.by] && b.aliveNow[la.target] && b.susp[la.target] < 30 && ok(la.target, 'defend') && !saidKind('disagree', la.target)) {
    out.push({ key: `disagree:${la.target}`, label: `${ctx.name(la.by)}の${ctx.name(la.target)}への疑いに反対`, kind: 'disagree', pers: 'defend', target: la.target, heat: b.heat(la.target), rule: ((100 - b.susp[la.target]) * 0.5 + b.heat(la.target) * 30 - 30 * times(`disagree:${la.target}`)) * cw, st: { kind: 'disagree', target: la.target, ref: la.by } });
  }
  // 様子見
  const maxSusp = bySusp.length ? rankScore(bySusp[0]) : 0;
  // 指名して意見を求められた日は「様子見」で流しにくい
  const asked = b.wasAsked(me, day);
  const waitRule = (day === 1 && round === 0 ? 52 : maxSusp < 30 ? 42 : 14) - 18 * times('wait') - (asked ? 12 : 0);
  // 指名して聞かれていたら、「様子見」でも聞かれたことに答える形にする(無視に見えない)
  const asker = asked ? ctx.obs.events.find((e) => e.t === 'say' && e.day === day && e.st.kind === 'ask' && e.st.target === me) : undefined;
  out.push({ key: 'wait', label: asker ? '聞かれたが保留と答える' : '様子見', kind: 'wait', pers: 'wait', rule: waitRule, heat: 0, st: asker && asker.t === 'say' ? { kind: 'wait', tag: 'asked', ref: asker.by } : { kind: 'wait' } });
  // 投票宣言(最終ラウンドのみ)
  if (round >= rounds - 1 && (day > 1 || ctx.obs.config.day1Vote)) {
    const t = bySusp.find((x) => ok(x, 'vote'));
    if (t != null) {
      const rule = 25 + rankScore(t) * 0.8 - 40 * times(`vote_intent:${t}`);
      out.push({
        key: `vote_intent:${t}`, label: `${ctx.name(t)}への投票を宣言`, kind: 'vote_intent', pers: 'accuse', target: t, rule, heat: b.heat(t),
        st: { kind: 'vote_intent', target: t, reason: b.publicReason(t) },
      });
    }
  }
  // ---- 進行の提案(占い師COが複数いるとき: ローラー or グレー吊り。黒先がいれば黒先吊り) ----
  const claimants = [...b.seerClaims.keys()].filter((c) => b.aliveNow[c] && c !== me);
  const canVoteToday = day > 1 || ctx.obs.config.day1Vote;
  // 同じ提案が今日すでに何回出たか(同じ提案の連呼を避ける)
  const proposedToday = (plan: string, target?: number) => ctx.obs.events.filter((e) => e.t === 'say' && e.day === day && e.st.kind === 'propose' && e.st.plan === plan && (target == null || e.st.target === target)).length;
  if (canVoteToday && ctx.role !== 'seer') {
    const blacks = b.trustedBlackTargets().filter((t) => ok(t, 'accuse'));
    if (blacks.length) {
      const t = blacks.sort((x, y) => b.susp[y] - b.susp[x])[0];
      out.push({ key: `propose:black`, label: `黒先(${ctx.name(t)})を吊ろうと提案`, kind: 'propose', pers: 'accuse', target: t, heat: b.heat(t), rule: 40 + b.susp[t] * 0.3 - 35 * times('propose:black') - 14 * proposedToday('black', t), st: { kind: 'propose', plan: 'black', target: t } });
    } else if (claimants.length >= 2) {
      const undecided = claimants.every((c) => Math.abs(b.seerTrust(c) - 1 / b.seerClaims.size) < 0.15);
      out.push({ key: 'propose:roller', label: '占い師ローラーを提案', kind: 'propose', pers: 'accuse', heat: 0, rule: (undecided ? 40 : 24) - 35 * times('propose:roller') - 10 * proposedToday('roller'), st: { kind: 'propose', plan: 'roller' } });
      out.push({ key: 'propose:grey', label: 'グレー吊りを提案', kind: 'propose', pers: 'defend', heat: 0, rule: (undecided ? 42 : 26) - 35 * times('propose:grey') - 10 * proposedToday('grey'), st: { kind: 'propose', plan: 'grey' } });
    }
    const meds = [...b.mediumClaims.keys()].filter((c) => b.aliveNow[c] && c !== me);
    if (meds.length >= 2 && !(ctx.role === 'medium')) out.push({ key: 'propose:medium_roller', label: '霊能ローラーを提案', kind: 'propose', pers: 'accuse', heat: 0, rule: 34 - 35 * times('propose:medium_roller'), st: { kind: 'propose', plan: 'medium_roller' } });
  }

  // ---- 考察(2日目以降) ----
  if (day >= 2) {
    // 昨日の投票への言及: 流れと違う票(処刑者以外に入れた人)のうち、一番疑わしい人
    const yv = b.votesOn(day - 1);
    const ex = b.executedOn(day - 1);
    if (yv && round === 0) {
      let best: [number, number] | null = null;
      yv.forEach((tg, v) => {
        if (v === me || !b.aliveNow[v] || tg === ex || !ok(v, 'accuse')) return;
        if (!best || b.susp[v] > b.susp[best[0]]) best = [v, tg];
      });
      if (best) {
        const [v, tg] = best as [number, number];
        out.push({ key: `vote_review:${v}`, label: `${ctx.name(v)}の昨日の票を指摘`, kind: 'vote_review', pers: 'accuse', target: v, heat: b.heat(v), rule: b.susp[v] * 0.6 + 24 - 30 * times(`vote_review:${v}`), st: { kind: 'vote_review', target: v, ref: tg } });
      }
    }
    // 襲撃先の考察(その朝の死者。役職COしていない人)
    const dead = b.deathsOn(day).filter((d) => !b.seerClaims.has(d) && !b.mediumClaims.has(d));
    if (dead.length && round === 0) out.push({ key: 'attack_review', label: `${ctx.name(dead[0])}が噛まれた理由を考察`, kind: 'attack_review', pers: 'neutral', target: dead[0], heat: 0, rule: 40 - 30 * times('attack_review'), st: { kind: 'attack_review', target: dead[0] } });
    // 霊能結果からの指摘: 黒と判明した処刑者に投票していなかった人
    for (const [t, c] of b.confirmed) {
      if (c !== 'black') continue;
      const exDay = [...Array(day).keys()].find((d) => b.executedOn(d) === t);
      const votes = exDay != null ? b.votesOn(exDay) : undefined;
      if (!votes) continue;
      const cands = others.filter((p) => ok(p, 'accuse') && votes.get(p) !== t && votes.has(p)).sort((x, y) => b.susp[y] - b.susp[x]);
      if (cands.length) {
        const p = cands[0];
        out.push({ key: `medium_review:${p}`, label: `黒の${ctx.name(t)}に入れなかった${ctx.name(p)}を指摘`, kind: 'medium_review', pers: 'accuse', target: p, heat: b.heat(p), rule: b.susp[p] * 0.6 + 26 - 30 * times(`medium_review:${p}`), st: { kind: 'medium_review', target: p } });
      }
      break;
    }
    // ライン指摘: 疑わしい人と、昨日同じ相手に投票した人
    if (yv && bySusp.length >= 2) {
      const p = bySusp.find((x) => ok(x, 'accuse') && b.susp[x] > 40 && yv.has(x) && yv.get(x) !== ex);
      if (p != null) {
        const q = others.filter((x) => x !== p && ok(x, 'accuse') && yv.get(x) === yv.get(p) && b.susp[x] > 28).sort((x, y) => b.susp[y] - b.susp[x])[0];
        if (q != null) out.push({ key: `line:${p}:${q}`, label: `${ctx.name(p)}と${ctx.name(q)}のラインを指摘`, kind: 'line', pers: 'accuse', target: p, heat: b.heat(p), rule: 30 + (b.susp[p] + b.susp[q]) * 0.25 - 30 * times(`line:${p}:${q}`), st: { kind: 'line', target: p, ref: q } });
      }
    }
  }

  // ---- 会話の取っ掛かり(定石由来) ----
  // COの速さ(1〜2日目): 最初に出た占い師COは「迷わず出た」、2人目以降は「後出し」
  if (day <= 2 && b.seerClaims.size >= 2 && ctx.role !== 'seer') {
    const order = [...b.seerClaims.keys()].filter((c) => b.aliveNow[c] && c !== me);
    const nClaims = b.seerClaims.size;
    for (const c of order) {
      const idx = b.seerCoIndex(c);
      // 最初に出た人だけ「迷わず」、最後に出た人だけ「後出し」(間の人はどちらとも言わない)
      if (idx !== 0 && idx !== nClaims - 1) continue;
      const tag = idx === 0 ? 'early' : 'late';
      if (saidKind('co_timing', c)) continue;
      // 自分の見立てと合うときだけ言う(後出しを疑う/先出しを信じる)
      const fits = tag === 'late' ? b.seerTrust(c) < 0.5 : b.seerTrust(c) >= 0.3;
      if (!fits) continue;
      out.push({ key: `co_timing:${c}`, label: `${ctx.name(c)}のCOの速さに言及(${tag === 'late' ? '後出し' : '迷わず'})`, kind: 'co_timing', pers: tag === 'late' ? 'accuse' : 'defend', target: c, heat: b.heat(c), rule: (34 + (tag === 'late' ? (1 - b.seerTrust(c)) * 22 : b.seerTrust(c) * 18) - 40 * times(`co_timing:${c}`)) * cw, st: { kind: 'co_timing', target: c, tag } });
    }
  }
  // 指名して意見を聞く: 今日まだ(ほぼ)発言していない人に。序盤の会話の取っ掛かり
  if (round === 0) {
    // 今日まだ一言も話していない人(「様子見」でも話した人には聞かない: 話した直後に「黙ってないで」は変)
    const quiet = others.filter((t) => !saysToday.some((e) => e.by === t) && !b.wasAsked(t, day) && !saidKind('ask', t));
    if (quiet.length) {
      const t = quiet.sort((x, y) => b.susp[y] - b.susp[x])[0];
      out.push({ key: `ask:${t}`, label: `${ctx.name(t)}に意見を聞く`, kind: 'ask', pers: 'neutral', target: t, heat: 0, rule: ((day === 1 ? 44 : 30) + b.susp[t] * 0.1 - 30 * times('ask')) * cw, st: { kind: 'ask', target: t } });
    }
  }
  if (day >= 2) {
    const yst = b.stanceOn(day - 1);
    // ブレの指摘: 昨日の矛先と今日の矛先が違う人(人狼は村の流れに合わせて疑い先を変えがち)
    if (yst && round >= 1) {
      let best: [number, number] | null = null;
      b.stance.forEach((today, p) => {
        if (p === me || !b.aliveNow[p] || !ok(p, 'accuse')) return;
        const y = yst.get(p);
        if (y == null || y === today || y === p || !b.aliveNow[y] || y === b.executedOn(day - 1)) return; // 昨日の相手が死んでいれば変えて当然
        if (!best || b.susp[p] > b.susp[best[0]]) best = [p, y];
      });
      if (best) {
        const [p, y] = best as [number, number];
        out.push({ key: `waver:${p}`, label: `${ctx.name(p)}のブレを指摘(昨日は${ctx.name(y)})`, kind: 'waver', pers: 'accuse', target: p, heat: b.heat(p), rule: (30 + b.susp[p] * 0.5 - 35 * times(`waver:${p}`)) * cwA, st: { kind: 'waver', target: p, ref: y } });
      }
    }
    // 噛み筋: 今朝噛まれた人が昨日疑っていた人は人狼寄り、かばっていた人は白寄り
    for (const d of b.deathsOn(day)) {
      if (b.seerClaims.has(d) || b.mediumClaims.has(d)) continue;
      const y = yst?.get(d);
      if (y != null && b.aliveNow[y] && y !== me && ok(y, 'accuse') && !saidKind('bite_logic', y)) {
        out.push({ key: `bite:${y}`, label: `噛まれた${ctx.name(d)}が疑っていた${ctx.name(y)}を指摘`, kind: 'bite_logic', pers: 'accuse', target: y, heat: b.heat(y), rule: (36 + b.susp[y] * 0.4 - 35 * times(`bite:${y}`)) * cwA, st: { kind: 'bite_logic', target: y, ref: d, color: 'black' } });
      }
      const dfd = b.defendsOn(day - 1).filter((x) => x.by === d && b.aliveNow[x.target] && x.target !== me);
      if (dfd.length && !saidKind('bite_logic', dfd[0].target)) {
        const t = dfd[0].target;
        out.push({ key: `bitew:${t}`, label: `噛まれた${ctx.name(d)}がかばっていた${ctx.name(t)}は白寄りと指摘`, kind: 'bite_logic', pers: 'defend', target: t, heat: b.heat(t), rule: (24 + (100 - b.susp[t]) * 0.2 - 35 * times(`bitew:${t}`)) * cw, st: { kind: 'bite_logic', target: t, ref: d, color: 'white' } });
      }
      break;
    }
    // 沈黙の指摘(最終ラウンド): 今日まだ発言していない人
    if (round >= rounds - 1) {
      const silent = others.filter((t) => b.spokeCount(t) === 0 && ok(t, 'accuse') && !saidKind('silent_point', t));
      if (silent.length) {
        const t = silent.sort((x, y) => b.susp[y] - b.susp[x])[0];
        out.push({ key: `silent:${t}`, label: `${ctx.name(t)}の沈黙を指摘`, kind: 'silent_point', pers: 'accuse', target: t, heat: b.heat(t), rule: (34 + b.susp[t] * 0.4 - 35 * times(`silent:${t}`)) * cwA, st: { kind: 'silent_point', target: t } });
      }
    }
    // 確定の宣言: 占い師COが噛まれた(=本物)なら、残った占い師COは偽物で確定
    const atk = b.attackedSeerClaimants();
    if (atk.length && ctx.role !== 'seer') {
      const fakes = [...b.seerClaims.keys()].filter((c) => b.aliveNow[c] && c !== me && ok(c, 'accuse'));
      for (const c of fakes.slice(0, 1)) {
        if (saidKind('confirm', c)) continue;
        out.push({ key: `confirm:${c}`, label: `${ctx.name(c)}はまず偽物と宣言`, kind: 'confirm', pers: 'accuse', target: c, heat: b.heat(c), rule: (52 + (1 - b.seerTrust(c)) * 20 - 40 * times(`confirm:${c}`)) * ctx.f.v('confirmW'), st: { kind: 'confirm', target: c, ref: atk[0] } });
      }
    }
    // 破綻した占い師COの確定宣言
    for (const [c, cl] of b.seerClaims) {
      if (cl.broken && b.aliveNow[c] && c !== me && ok(c, 'accuse') && !saidKind('confirm', c)) out.push({ key: `confirm:${c}`, label: `${ctx.name(c)}は破綻で確定と宣言`, kind: 'confirm', pers: 'accuse', target: c, heat: b.heat(c), rule: (60 - 40 * times(`confirm:${c}`)) * ctx.f.v('confirmW'), st: { kind: 'confirm', target: c, reason: 'broken' } });
    }
    // 人数カウント(終盤ほど言いたくなる): 生存 n、人狼の残り見込み m。n <= 2m+2 なら今日外すと危ない
    const n = b.aliveCount();
    const m = Math.max(1, b.wolvesLeftMax());
    if (!saysToday.some((e) => e.st.kind === 'count') && round === 0 && ctx.obs.config.roleCounts.werewolf > 0) {
      const tight = n <= 2 * m + 2;
      out.push({ key: 'count', label: `人数カウント(残り${n}人・人狼${m})`, kind: 'count', pers: 'neutral', heat: 0, rule: ((tight ? 44 : 14) - 30 * times('count')) * cw, st: { kind: 'count', n, m } });
    }
  }

  // 占い師にCOを促す(1日目の最初だけ)
  if (day === 1 && round === 0 && !mem.askedCo && b.seerClaims.size === 0 && ctx.role !== 'seer') {
    out.push({ key: 'ask_co', label: '占い師にCOを促す', kind: 'ask_co', pers: 'neutral', rule: 28, heat: 0, st: { kind: 'ask_co' } });
  }
  // 同じ日の中で向きを変えない: 今日かばった人を疑う候補、今日疑った人をかばう候補は外す(強い根拠が新たに出たときの疑いは残す)
  return out.filter((c) => {
    const t = c.target;
    if (t == null) return true;
    const hostile = c.pers === 'accuse' || c.kind === 'agree' || c.kind === 'vote_intent' || (c.kind === 'co_timing' && c.st?.tag === 'late') || (c.kind === 'bite_logic' && c.st?.color === 'black');
    const friendly = (c.pers === 'defend' && c.kind !== 'defend_self') || (c.kind === 'co_timing' && c.st?.tag === 'early') || (c.kind === 'bite_logic' && c.st?.color === 'white');
    if (hostile && defendedToday.has(t) && !strongNow(t)) return false;
    if (friendly && accusedToday.has(t)) return false;
    return true;
  });
}
