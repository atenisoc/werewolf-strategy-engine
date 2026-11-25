import assert from 'node:assert/strict';
import { makeConfig } from '../src/game/config';
import { runAiGame } from '../src/game/run';
import { Session } from '../src/game/session';
import { ROLES } from '../src/game/roles';
import { runNaturalnessAudit } from '../src/simulation/naturalness';
import { auditInvariants, auditLeaks } from '../src/simulation/audit';
import { formatThink } from '../src/logs/think';
import { decodeReplay, encodeReplay } from '../src/logs/replay';
import type { HumanResponse } from '../src/game/engine';
import type { RoleId } from '../src/game/types';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  NG  ' + name + '\n      ' + (e instanceof Error ? e.message : e));
    process.exitCode = 1;
  }
}
const SIZES = [5, 7, 9, 13, 15];

test('同じseedなら同じ試合(イベント・AI思考ログまで完全一致)', () => {
  for (const n of SIZES) {
    const a = runAiGame(18427, makeConfig(n));
    const b = runAiGame(18427, makeConfig(n));
    assert.equal(JSON.stringify(a.state.events), JSON.stringify(b.state.events));
    assert.equal(JSON.stringify(a.agents.map((x) => x?.log)), JSON.stringify(b.agents.map((x) => x?.log)));
  }
});

test('違うseedなら違う試合になる', () => {
  const sigs = new Set<string>();
  for (let s = 1; s <= 20; s++) sigs.add(JSON.stringify(runAiGame(s, makeConfig(7), { logging: false }).state.events));
  assert.ok(sigs.size >= 19, `distinct games: ${sigs.size}/20`);
});

test('ログを取っても試合結果は変わらない(ログは乱数を消費しない)', () => {
  const a = runAiGame(777, makeConfig(9), { logging: true });
  const b = runAiGame(777, makeConfig(9), { logging: false });
  assert.equal(JSON.stringify(a.state.events), JSON.stringify(b.state.events));
});

test('情報漏洩なし: 他人の役職を入れ替えても観測が変わらない(各人数200試合)', () => {
  for (const n of SIZES) {
    for (let s = 1; s <= 200; s++) {
      const { state } = runAiGame(s, makeConfig(n), { logging: false });
      assert.deepEqual(auditLeaks(state), [], `n=${n} seed=${s}`);
    }
  }
});

test('試合の整合性(死者は発言・投票しない / 勝敗判定の一致 / 決着する) 各人数500試合', () => {
  for (const n of SIZES) {
    for (let s = 1; s <= 500; s++) {
      const { state } = runAiGame(s, makeConfig(n), { logging: false });
      assert.deepEqual(auditInvariants(state), [], `n=${n} seed=${s}`);
    }
  }
});

test('人狼は仲間を疑わず、仲間に黒判定(偽)も出さない', () => {
  for (let s = 1; s <= 300; s++) {
    const { state } = runAiGame(s, makeConfig(9), { logging: false });
    const isWolf = (i: number) => ROLES[state.players[i].role].isWolf;
    for (const e of state.events) {
      if (e.t !== 'say' || !isWolf(e.by)) continue;
      if ((e.st.kind === 'accuse' || e.st.kind === 'agree') && e.st.target != null) assert.ok(!isWolf(e.st.target), `wolf accused mate (seed ${s})`);
      if (e.st.color === 'black' && e.st.target != null) assert.ok(!isWolf(e.st.target), `wolf fake-black on mate (seed ${s})`);
    }
  }
});

test('共有者は相方を疑わず・投票せず、相方以外の共有者COを偽物と見る(15人村)', () => {
  let masonCo = 0;
  for (let s = 1; s <= 300; s++) {
    const roles = [...makeConfig(15).roles.filter((r) => r !== 'fox' && r !== 'villager'), 'mason', 'mason', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager'] as RoleId[];
    const { state, agents } = runAiGame(s, makeConfig(15, { roles }));
    const isMason = (i: number) => state.players[i].role === 'mason';
    for (const e of state.events) {
      if (e.t === 'say' && isMason(e.by)) {
        if ((e.st.kind === 'accuse' || e.st.kind === 'agree' || e.st.kind === 'vote_intent') && e.st.target != null) assert.ok(!isMason(e.st.target), `mason accused mate (seed ${s})`);
        if (e.st.kind === 'co' && e.st.claim === 'mason') masonCo++;
      }
      if (e.t === 'vote' && e.round === 0 && isMason(e.by)) assert.ok(!isMason(e.target), `mason voted mate (seed ${s})`); // 決選投票で相方しか候補にないときは仕方なく入れる
    }
    // 共有者の思考ログ: 相方の疑惑度は常に最小(確定白)
    for (const a of agents) {
      if (!a || !isMason(a.id)) continue;
      for (const l of a.log) for (const sp of l.suspicion) if (isMason(sp.id)) assert.ok(sp.value <= 1.5, `mason suspects mate ${sp.value} (seed ${s})`);
    }
  }
  assert.ok(masonCo > 300, `masons should usually CO (${masonCo})`);
});

test('人狼は「判定が真実と違う占い師CO(=狂人)」を襲撃しない', () => {
  for (let s = 1; s <= 400; s++) {
    const { state } = runAiGame(s, makeConfig(13), { logging: false });
    const P = state.players;
    // 狂人が占い師COして偽の結果を言ったあとに襲撃されていないこと
    const madClaimDay = new Map<number, number>();
    for (const e of state.events) {
      if (e.t === 'say' && P[e.by].role === 'madman' && (e.st.kind === 'co' || e.st.kind === 'result') && e.st.claim === 'seer' && e.st.target != null) {
        const truth = ROLES[P[e.st.target].role].seerColor;
        if (e.st.color !== truth && !madClaimDay.has(e.by)) madClaimDay.set(e.by, e.day);
      }
      if (e.t === 'death' && madClaimDay.has(e.target)) assert.fail(`wolves attacked a known madman (seed ${s}, day ${e.day})`);
    }
  }
});

test('妖狐: 襲撃では死なず、占われた翌朝に死ぬ。生き残れば妖狐の単独勝ち(15人村)', () => {
  let cursed = 0, foxWins = 0;
  for (let s = 1; s <= 300; s++) {
    const { state, result } = runAiGame(s, makeConfig(15), { logging: false });
    const fox = state.players.find((p) => p.role === 'fox')!;
    const death = state.events.find((e) => e.t === 'death' && e.target === fox.id) as Extract<(typeof state.events)[number], { t: 'death' }> | undefined;
    if (death) {
      // 夜に死んだ妖狐は、必ずその前夜に占い師に占われている(=呪殺)
      const divined = Object.values(state.priv.seer).some((list) => list.some((d) => d.target === fox.id && d.day === death.day - 1));
      assert.ok(divined, `fox died at night without being divined (seed ${s})`);
      cursed++;
    }
    if (fox.alive) {
      assert.equal(result.winner, 'fox', `fox alive at end but winner ${result.winner} (seed ${s})`);
      foxWins++;
    } else assert.notEqual(result.winner, 'fox', `fox dead but fox won (seed ${s})`);
  }
  assert.ok(cursed > 20 && foxWins > 10, `curses ${cursed}, fox wins ${foxWins}`);
});

test('新しい発言(提案・考察・護衛報告)が形式チェックを通り、実際に使われる', () => {
  const kinds = new Set<string>();
  for (let s = 1; s <= 200; s++) {
    const { state } = runAiGame(s, makeConfig(13), { logging: false });
    for (const e of state.events) if (e.t === 'say') kinds.add(e.st.kind + (e.st.kind === 'propose' ? ':' + e.st.plan : e.st.kind === 'result' ? ':' + e.st.claim : e.st.kind === 'co_timing' ? ':' + e.st.tag : e.st.kind === 'bite_logic' ? ':' + e.st.color : ''));
  }
  for (const k of ['propose:black', 'propose:roller', 'propose:grey', 'vote_review', 'attack_review', 'medium_review', 'line', 'result:hunter', 'co_timing:late', 'co_timing:early', 'ask', 'count', 'confirm', 'waver', 'bite_logic:black', 'silent_point']) assert.ok(kinds.has(k), `kind ${k} never used`);
});

test('人間が人狼のとき、作戦会議(騙り役・囲い・身内切り)の決定を仲間のAIが守る', () => {
  // 人間(席0)を人狼にして、仲間に占い騙りを任せ、囲いあり・身内切りなしにする
  const cfg = makeConfig(13, { humanSeat: 0, humanRole: 'werewolf' });
  const s1 = new Session(777, cfg);
  let guard = 0;
  let mateFake = -1;
  while (s1.pending && guard++ < 800) {
    const req = s1.pending;
    if (req.type === 'plan') {
      mateFake = req.mates[0];
      s1.respond({ fakeSeer: mateFake, kakoi: true, cut: false });
    } else if (req.type === 'talk') s1.respond({ kind: 'wait' });
    else s1.respond(req.candidates[0]);
  }
  assert.ok(s1.result, 'game finished');
  const P = s1.state.players;
  const plan = s1.state.priv.wolfChat.find((m) => m.kind === 'plan')!;
  assert.equal(plan.fakeSeer, mateFake);
  assert.equal(plan.kakoi, true);
  assert.equal(plan.cut, false);
  // 指定した仲間だけが占い師を騙り、人間以外の人狼は(決選投票を除き)仲間に投票しない
  for (const e of s1.state.events) {
    if (e.t === 'say' && e.st.claim === 'seer' && ROLES[P[e.by].role].isWolf) assert.equal(e.by, mateFake, `unexpected wolf fake by ${e.by}`);
    if (e.t === 'vote' && e.round === 0 && e.by !== 0 && P[e.by].role === 'werewolf') assert.ok(!ROLES[P[e.target].role].isWolf, `wolf voted mate despite cut=false (day ${e.day})`);
  }
});

test('本物の占い師は事実どおりの結果だけを報告する', () => {
  for (let s = 1; s <= 300; s++) {
    const { state } = runAiGame(s, makeConfig(9), { logging: false });
    const seer = state.players.find((p) => p.role === 'seer')!;
    for (const e of state.events) {
      if (e.t === 'say' && e.by === seer.id && e.st.claim === 'seer' && e.st.target != null) {
        const truth = ROLES[state.players[e.st.target].role].seerColor;
        assert.equal(e.st.color, truth, `seer lied (seed ${s})`);
      }
    }
  }
});

test('判断の重みが設定どおり(ルール約75% / 性格約15% / 乱数約10%)', () => {
  let r = 0, p = 0, z = 0, k = 0;
  for (let s = 1; s <= 50; s++) {
    const { agents } = runAiGame(s, makeConfig(7));
    for (const a of agents) for (const l of a?.log ?? []) {
      const c = l.candidates.find((x) => x.label === l.chosen);
      if (!c || c.total <= 0) continue;
      r += c.rule / c.total; p += c.personality / c.total; z += c.noise / c.total; k++;
    }
  }
  const [R, P, Z] = [r / k, p / k, z / k];
  console.log(`      選ばれた行動の得点内訳: ルール${(R * 100).toFixed(0)}% 性格${(P * 100).toFixed(0)}% 乱数${(Z * 100).toFixed(0)}% (n=${k})`);
  assert.ok(R > 0.6 && R < 0.9, `rule share ${R}`);
  assert.ok(Z > 0.03 && Z < 0.2, `noise share ${Z}`);
});

test('AI思考ログに「内部認識」と「表向き発言」が分けて記録される(人狼)', () => {
  const { agents, state } = runAiGame(18427, makeConfig(7));
  const wolfLogs = agents.flatMap((a) => a?.log ?? []).filter((l) => l.role === 'werewolf' && l.phase === 'talk');
  assert.ok(wolfLogs.length > 0);
  assert.ok(wolfLogs.every((l) => l.internal && l.internal.some((x) => x.startsWith('仲間'))));
  assert.ok(wolfLogs.every((l) => !!l.text));
  assert.ok(formatThink(wolfLogs[0]).includes('【内部】'));
  const villLogs = agents.flatMap((a) => a?.log ?? []).filter((l) => l.role === 'villager');
  assert.ok(villLogs.every((l) => !l.internal));
  void state;
});

test('破綻: 偽占いの黒先が処刑されて霊能(1人)が白を出したら、村はその占い師を吊りに行く', () => {
  let checked = 0;
  for (let seed = 1; seed <= 40 && checked < 3; seed++) {
    const cfg = makeConfig(13, { humanSeat: 0, humanRole: 'madman' });
    const s1 = new Session(seed, cfg);
    const P = s1.state.players;
    const victim = P.find((p) => p.id !== 0 && p.role === 'villager')!.id; // 村人に偽の黒を出す
    let guard = 0;
    let coDone = false;
    while (s1.pending && guard++ < 800) {
      const req = s1.pending;
      if (req.type === 'talk') {
        if (!coDone && req.obs.day === 1) { coDone = true; s1.respond({ kind: 'co', claim: 'seer', target: victim, color: 'black' }); }
        else s1.respond({ kind: 'wait' });
      } else if (req.type === 'vote') s1.respond(req.candidates.includes(victim) ? victim : req.candidates[0]);
      else if (req.type === 'plan') s1.respond({ fakeSeer: null, kakoi: false, cut: true });
      else s1.respond(req.candidates[0]);
    }
    const ev = s1.state.events;
    const exec = ev.find((e) => e.t === 'execute' && e.target === victim);
    if (!exec || exec.t !== 'execute') continue;
    // 霊能(本物・1CO)が「白」を公表した日
    const med = ev.find((e) => e.t === 'say' && (e.st.kind === 'result' || e.st.kind === 'co') && e.st.claim === 'medium' && e.st.target === victim && e.st.color === 'white' && P[e.by].role === 'medium');
    if (!med || med.t !== 'say') continue;
    if (ev.some((e) => (e.t === 'execute' || e.t === 'death') && e.target === 0 && e.day < med.day)) continue; // 霊能結果が出る前に人間が死んでいたら対象外
    const mediumCos = new Set(ev.filter((e) => e.t === 'say' && e.st.claim === 'medium').map((e) => (e as Extract<typeof e, { t: 'say' }>).by));
    if (mediumCos.size !== 1) continue;
    // その日の投票(1回目)で、村側AIの過半数が人間(破綻した占い師)に入れる
    const votes = ev.filter((e) => e.t === 'vote' && e.day === med.day && e.round === 0 && e.by !== 0 && ROLES[P[e.by].role].camp === 'village') as Extract<(typeof ev)[number], { t: 'vote' }>[];
    if (!votes.length) continue;
    const onMe = votes.filter((v) => v.target === 0).length;
    assert.ok(onMe * 2 > votes.length, `seed ${seed}: 破綻後の村側の票 ${onMe}/${votes.length} が人間に向いていない`);
    // 発言の根拠にも「破綻」が出る
    // 根拠として「破綻」(または本物が噛まれていれば「偽物確定」)が語られる
    assert.ok(ev.some((e) => e.t === 'say' && e.day === med.day && e.st.target === 0 && (e.st.reason === 'broken' || e.st.reason === 'fake_confirmed' || e.st.kind === 'confirm')), `seed ${seed}: 破綻を理由にした発言がない`);
    checked++;
  }
  assert.ok(checked >= 1, '検証できる試合がなかった');
});

test('視点の整合性: 役職CO(本物も騙りも)は自分の白を疑わず・吊らず、対抗の黒を根拠にしない', () => {
  let whiteVotes = 0, whiteAccuse = 0, rivalReason = 0, claimVotes = 0, ownBlackPush = 0, ownBlackAlive = 0;
  for (let s = 1; s <= 200; s++) {
    const { state } = runAiGame(s, makeConfig(13), { logging: false });
    const ev = state.events;
    const said = new Map<number, Map<number, 'white' | 'black'>>(); // by → target → color(自分が公開した占い)
    const claimed = new Set<number>();
    const human = state.players.map(() => false);
    for (const e of ev) {
      if (e.t === 'say' && (e.st.kind === 'co' || e.st.kind === 'result') && e.st.claim === 'seer') {
        claimed.add(e.by);
        if (e.st.target != null && e.st.color) { if (!said.has(e.by)) said.set(e.by, new Map()); said.get(e.by)!.set(e.st.target, e.st.color); }
      }
      if (e.t === 'say' && claimed.has(e.by) && e.st.target != null) {
        const mine = said.get(e.by)?.get(e.st.target);
        if ((e.st.kind === 'accuse' || e.st.kind === 'vote_intent' || e.st.kind === 'agree') && mine === 'white') whiteAccuse++;
        if (e.st.reason === 'seer_black' && mine !== 'black') rivalReason++;
      }
      if (e.t === 'vote' && e.round === 0 && claimed.has(e.by) && !human[e.by]) { // 決選投票は候補が限られる(仲間か自分の白か)ので除く
        claimVotes++;
        // 白を出していない生存者(人狼なら仲間以外)が1人でもいれば、白に入れるのは矛盾
        const mates = new Set(state.players[e.by].role === 'werewolf' ? state.players.filter((p) => p.role === 'werewolf').map((p) => p.id) : []);
        const alt = state.players.some((p) => p.id !== e.by && !mates.has(p.id) && said.get(e.by)?.get(p.id) !== 'white' && !ev.some((x) => (x.t === 'execute' || x.t === 'death') && x.target === p.id && x.day <= e.day));
        if (alt && said.get(e.by)?.get(e.target) === 'white') whiteVotes++;
      }
      // 自分の黒が生きている日の投票は、その黒に入れる(ほかの候補がよほど強くない限り)
      if (e.t === 'vote' && e.round === 0 && claimed.has(e.by)) {
        const blacks = [...(said.get(e.by) ?? [])].filter(([t, c]) => c === 'black' && state.players[t].alive !== undefined && !ev.some((x) => (x.t === 'execute' || x.t === 'death') && x.target === t && x.day <= e.day)).map(([t]) => t);
        // 例外: その日に多数派が対抗の占いCOを吊った(自分も乗ってよい)ときは数えない
        const execd = ev.find((x) => x.t === 'execute' && x.day === e.day);
        const rivalLynched = execd && execd.t === 'execute' && claimed.has(execd.target) && execd.target !== e.by;
        if (blacks.length && !rivalLynched) { ownBlackAlive++; if (blacks.includes(e.target)) ownBlackPush++; }
      }
    }
  }
  assert.ok(claimVotes >= 100, `占い師COの投票例が少ない: ${claimVotes}`);
  assert.equal(whiteVotes, 0, `自分が白を出した相手に投票した ${whiteVotes}/${claimVotes}`);
  assert.equal(whiteAccuse, 0, `自分が白を出した相手を疑った ${whiteAccuse}`);
  assert.equal(rivalReason, 0, `占い師COが対抗の黒判定を根拠にした ${rivalReason}`);
  if (ownBlackAlive) assert.ok(ownBlackPush / ownBlackAlive >= 0.8, `自分の黒を吊りに行っていない ${ownBlackPush}/${ownBlackAlive}`);
});

test('狩人COの定石: 本物の狩人COはその夜に噛まれる / 人狼の狩人騙りは噛まれずに疑われる', () => {
  let coNights = 0, bitten = 0, fakeCos = 0, fakeSuspected = 0, gjCos = 0, gjReal = 0, gjTrusted = 0, gjWrong = 0, wolfHunterCos = 0;
  for (let s = 1; s <= 300; s++) {
    const { state, agents } = runAiGame(s, makeConfig(13), { logging: false });
    const P = state.players;
    const ev = state.events;
    const deathOn = (day: number) => ev.filter((e) => e.t === 'death' && e.day === day).map((e) => (e as Extract<typeof e, { t: 'death' }>).target);
    const deadBy = (id: number, day: number) => ev.some((e) => (e.t === 'execute' || e.t === 'death') && e.target === id && e.day <= day);
    for (const e of ev) {
      if (e.t !== 'say' || e.st.kind !== 'co' || e.st.claim !== 'hunter') continue;
      const h = e.by;
      if (ROLES[P[h].role].isWolf) wolfHunterCos++;
      const otherHunterCo = ev.some((x) => x.t === 'say' && x.by !== h && x.st.claim === 'hunter' && x.day <= e.day);
      if (P[h].role === 'hunter') {
        // その日の処刑を生き延びて夜を迎え、翌朝の死者がいる(平和でない)なら、死者は狩人のはず
        if (deadBy(h, e.day)) continue;
        const d = deathOn(e.day + 1);
        if (!d.length || otherHunterCo) continue;
        coNights++;
        if (d.includes(h)) bitten++;
      }
      // 翌朝の判定チェック: 翌日の昼まで試合が続き、本人も生きていること
      if (deadBy(h, e.day + 1) || !ev.some((x) => x.t === 'phase' && x.phase === 'day' && x.day === e.day + 1)) continue;
      const ledger = agents.find((a, i) => a && i !== h && ROLES[P[i].role].camp === 'village' && P[i].alive)?.ledger();
      if (!ledger) continue;
      const peace = deathOn(e.day + 1).length === 0;
      if (peace) {
        // 平和な朝(護衛成功) → 「噛まれていない」と疑わず、本物寄りの判定チェックに入る
        gjCos++;
        if (ledger[h].some((it) => it.day === e.day + 1 && it.label.includes('噛まれていない'))) gjWrong++;
        // 本物(護衛報告を出す)には「判定チェック○」の加点が入る
        if (P[h].role === 'hunter') { gjReal++; if (ledger[h].some((it) => it.day === e.day + 1 && it.label.includes('判定チェック○'))) gjTrusted++; }
      } else if (ROLES[P[h].role].isWolf) {
        // 偽の狩人CO(人狼): 誰かが死んだ朝に生きていれば「噛まれていない」として疑われる
        fakeCos++;
        if (ledger[h].some((it) => it.day === e.day + 1 && it.label.includes('噛まれていない'))) fakeSuspected++;
      }
    }
  }
  assert.ok(coNights >= 20, `本物の狩人COの検証例が少ない: ${coNights}`);
  assert.ok(bitten / coNights >= 0.9, `狩人COの夜に狩人が噛まれた割合 ${bitten}/${coNights}`);
  // 人狼の狩人騙り自体は出る(翌日まで生き残れるかは村の強さ次第なので、生き残った例だけ「噛まれていない」の疑いを確認)
  assert.ok(wolfHunterCos >= 1, `人狼の狩人騙りが出ていない: ${wolfHunterCos}`);
  assert.equal(fakeSuspected, fakeCos, `噛まれない狩人COが疑われていない ${fakeSuspected}/${fakeCos}`);
  assert.ok(gjCos >= 1, `狩人COの翌朝が平和な例がない: ${gjCos}`);
  assert.equal(gjWrong, 0, `平和な朝なのに「噛まれていない」と疑っている ${gjWrong}/${gjCos}`);
  if (gjReal) assert.ok(gjTrusted / gjReal >= 0.8, `本物の狩人の護衛報告に判定チェック○が入っていない ${gjTrusted}/${gjReal}`);
});

test('人間参加の試合も 再現コード(seed+入力)で完全再生できる', () => {
  const cfg = makeConfig(7, { humanSeat: 0 });
  const s1 = new Session(4242, cfg);
  let guard = 0;
  while (s1.pending && guard++ < 500) {
    const req = s1.pending;
    if (req.type === 'talk') s1.respond(guard % 2 ? { kind: 'wait' } : { kind: 'accuse', target: req.obs.players.find((p) => p.alive && p.id !== req.playerId)!.id });
    else if (req.type === 'plan') s1.respond({ fakeSeer: req.playerId, kakoi: true, cut: false });
    else s1.respond(req.candidates[guard % req.candidates.length]);
  }
  assert.ok(s1.result, 'game finished');
  const code = encodeReplay({ v: 1, seed: 4242, n: 7, human: true, inputs: s1.inputs });
  const dec = decodeReplay(code)!;
  const s2 = new Session(dec.seed, makeConfig(dec.n, { humanSeat: 0 }), dec.inputs as HumanResponse[]);
  assert.ok(s2.result, 'replay finished');
  assert.equal(JSON.stringify(s1.state.events), JSON.stringify(s2.state.events));
});

test('役職が村人/占い師/人狼だけの5人村でも動く', () => {
  const { state } = runAiGame(1, makeConfig(5), { logging: false });
  assert.deepEqual([...new Set(state.players.map((p) => p.role))].sort(), ['seer', 'villager', 'werewolf']);
  assert.ok(state.winner === 'village' || state.winner === 'wolf');
});


test('投票のない日(7人村の初日)に「投票宣言」をしない', () => {
  for (let s = 1; s <= 200; s++) {
    const { state } = runAiGame(s, makeConfig(7), { logging: false });
    for (const e of state.events) if (e.t === 'say' && e.day === 1) assert.notEqual(e.st.kind, 'vote_intent', `seed ${s}`);
  }
});

test('不自然さの監査(回帰): 同日の向き変え・言い回しの重複・後出し誤り・指名無視・視点違反が閾値以下', () => {
  const r = runNaturalnessAudit(120, 13, 1);
  const c = r.counts;
  const per = (k: string) => (c[k] ?? 0) / Math.max(1, r.totalDays);
  assert.ok(per('accuse_after_defend') + per('defend_after_accuse') <= 0.03, `同日の向き変えが多い ${c.accuse_after_defend ?? 0}+${c.defend_after_accuse ?? 0}/${r.totalDays}日`);
  assert.ok(per('dup_phrase_same_day') <= 0.3, `同じ言い回しの重複が多い ${c.dup_phrase_same_day ?? 0}/${r.totalDays}日`);
  assert.equal(c.late_not_last ?? 0, 0, '最後のCO以外に「後出し」');
  assert.equal(c.asked_but_wait ?? 0, 0, '指名されたのに様子見');
  assert.equal((c.claimant_line_own_white ?? 0) + (c.claimant_defends_rival ?? 0), 0, '占い師COが自分の白をラインに含める/対抗をかばう');
  assert.equal(c.gj_not_reported ?? 0, 0, `狩人CO後の平和な朝に護衛報告がない ${c.gj_not_reported ?? 0}/${c.gj_morning_after_co ?? 0}`);
  for (const k of ['self_target', 'count_wrong', 'divine_twice', 'medium_not_executed']) assert.equal(c[k] ?? 0, 0, k);
  assert.ok((c.defend_self_used ?? 0) > 0 && (c.disagree_used ?? 0) > 0, '弁護・反対の発言が使われていない');
});

test('AIバリアント: baseline は登録簿経由でも同じ試合 / 見本バリアントは再現可能で既存AIと異なる判断をする', () => {
  // 登録簿(variants)を通しても既定AIの試合は1ビットも変わらない
  const a = runAiGame(777, makeConfig(9));
  const b = runAiGame(777, makeConfig(9), { variant: 'baseline' });
  assert.equal(JSON.stringify(a.state.events), JSON.stringify(b.state.events));
  // 見本バリアントは同じseedで再現でき、どこかで既定AIと違う行動を取る
  const c = runAiGame(777, makeConfig(9), { variant: 'example-skeptic' });
  const d = runAiGame(777, makeConfig(9), { variant: 'example-skeptic' });
  assert.equal(JSON.stringify(c.state.events), JSON.stringify(d.state.events));
  let differs = false;
  for (let s = 1; s <= 20 && !differs; s++) differs = JSON.stringify(runAiGame(s, makeConfig(9)).state.events) !== JSON.stringify(runAiGame(s, makeConfig(9), { variant: 'example-skeptic' }).state.events);
  assert.ok(differs, '見本バリアントが既定AIと同じ試合しか作らない');
  // 混合対戦(席ごとに違うAI)も観測の分離を破らない
  const e = runAiGame(31, makeConfig(13), { seatVariants: Array.from({ length: 13 }, (_, i) => (i % 2 ? 'example-skeptic' : 'baseline')) });
  assert.equal(auditLeaks(e.state).length, 0);
  assert.equal(auditInvariants(e.state).length, 0);
  assert.throws(() => runAiGame(1, makeConfig(7), { variant: 'no-such-variant' }), /unknown agent variant/);
});

console.log(`\n${passed} tests passed` + (process.exitCode ? ' (failures above)' : ''));
