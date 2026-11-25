import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeConfig } from '../game/config';
import { runAiGame } from '../game/run';
import { formatThink } from '../logs/think';
import { BatchRunner } from './batch';
import { recordsToCsv, summaryText } from './report';
import { RULE_FLAGS, TUNE_DEFAULTS } from '../agents/flags';
import { VARIANTS } from '../agents/variants';

// 使い方: node dist/sim.js --games 1000 --seed 1 --n 7 --out out
//         node dist/sim.js --replay 18427 --think        (1試合を詳細表示)
const args = process.argv.slice(2);
const get = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const has = (k: string) => args.includes('--' + k);

if (has('flags')) {
  for (const [k, v] of Object.entries(RULE_FLAGS)) console.log(`  ${k.padEnd(20)} ${v}`);
  console.log('\n数値パラメータ(--tune):');
  for (const [k, v] of Object.entries(TUNE_DEFAULTS)) console.log(`  ${k.padEnd(20)} 既定 ${v}`);
  process.exit(0);
}
if (has('variants')) {
  console.log('AIバリアント(--agent / --vs / --compare に指定):');
  for (const v of Object.values(VARIANTS)) console.log(`  ${v.name.padEnd(20)} ${v.description}`);
  process.exit(0);
}
if (has('help')) {
  console.log(`オプション:
  --games N       試合数(既定100)
  --seed S        開始seed(既定1)。試合ごとに S, S+1, ... を使う
  --n N           人数 5/7/9/13/15 (既定7)
  --weights a,b,c ルール,性格,乱数の重み (既定 0.75,0.15,0.10)
  --rounds R      1日の発言ラウンド数(既定2)
  --wolfFake P    人狼が占い師を騙る確率(既定0.75)
  --madFake P     狂人が占い師を騙る確率(既定0.5)
  --madFakeMed P  狂人が霊能者を騙る確率(占い騙りしないとき。既定0.5)
  --off a,b,c     推理ルールを無効化(検証用。一覧は --flags)
  --tune k=v,k=v  人狼側の数値パラメータを上書き(検証用。一覧は --flags)
  --w k=v,k=v     村側推理の重み(belief.ts の W)を上書き(調整用。一覧は --flags)
  --rules         推理ルールごとの精度(人狼に正しく向いた割合)を集計して表示
  --dump FILE     学習用データ(投票直前の台帳をルールごとに集計、JSONL)を書き出す
  --day1Vote 0|1  1日目に投票するか(既定: 9人以上=1 / 7人以下=0)
  --dialect 0|1   県ごとの口調を発言に乗せる(既定1。文章のみで判断には影響しない)
  --out DIR       summary.json / games.csv / anomalies.json を保存
  --audit         情報漏洩チェック(非干渉テスト)も実行
  --agent NAME    全席に使うAIバリアント(既定 baseline。一覧は --variants)
  --vs NAME       混合対戦: baseline(または --agent)と NAME を席に交互に配り、バリアント別の勝率を出す
  --compare NAME  同じseed群で「全席 baseline」と「全席 NAME」を走らせ、陣営勝率の差と95%信頼区間を表示
  --variants      AIバリアントの一覧
  --replay SEED   1試合を再現して表示   --think でAI思考ログも表示`);
  process.exit(0);
}

const n = Number(get('n', '7'));
const cfg = makeConfig(n, { rounds: Number(get('rounds', '2')) });
if (get('wolfFake') != null) cfg.behavior.wolfFakeProb = Number(get('wolfFake'));
if (get('madFake') != null) cfg.behavior.madFakeProb = Number(get('madFake'));
if (get('madFakeMed') != null) cfg.behavior.madFakeMediumProb = Number(get('madFakeMed'));
if (get('off')) cfg.behavior.off = get('off')!.split(',').filter(Boolean);
if (get('w')) cfg.behavior.w = { ...(cfg.behavior.w ?? {}), ...Object.fromEntries(get('w')!.split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; })) };
if (get('tune')) cfg.behavior.tune = { ...(cfg.behavior.tune ?? {}), ...Object.fromEntries(get('tune')!.split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; })) };
if (get('day1Vote') != null) cfg.day1Vote = get('day1Vote') === '1';
if (get('dialect') != null) cfg.dialect = get('dialect') === '1';
const w = get('weights');
if (w) {
  const [a, b, c] = w.split(',').map(Number);
  cfg.weights = { rule: a, personality: b, noise: c };
}

if (get('replay') != null) {
  const seed = Number(get('replay'));
  const { state, agents, result } = runAiGame(seed, cfg, { variant: get('agent') });
  console.log(`seed=${seed} 人数=${n}`);
  console.log('配役: ' + state.players.map((p) => `${p.name}=${p.role}(${p.personalityKey})`).join(' / '));
  for (const e of state.events) {
    if (e.t === 'say') console.log(`  [${e.day}日目] ${state.players[e.by].name}: ${e.text}`);
    else if (e.t === 'execute') console.log(`■ 処刑: ${state.players[e.target].name} (${e.votes}票)`);
    else if (e.t === 'death') console.log(`■ 死亡: ${state.players[e.target].name}`);
    else if (e.t === 'peace') console.log('■ 平和な朝');
    else if (e.t === 'end') console.log(`■ 勝者: ${e.winner}`);
  }
  console.log(result);
  if (has('think')) {
    console.log('\n===== AI思考ログ =====');
    const all = agents.flatMap((a) => a?.log ?? []).sort((x, y) => x.day - y.day || x.round - y.round);
    for (const l of all) console.log(formatThink(l) + '\n');
  }
  process.exit(0);
}

const games = Number(get('games', '100'));
const seed0 = Number(get('seed', '1'));
const t0 = Date.now();

// --compare NAME: 同じseed群で2回走らせて差を見る(勝率の差の95%信頼区間は正規近似)
if (get('compare') != null) {
  const name = get('compare')!;
  const run = (variant: string) => {
    const r = new BatchRunner({ games, seed0, cfg, variant });
    r.step(games);
    return r.finish();
  };
  const base = get('agent', 'baseline')!;
  const A = run(base);
  const B = run(name);
  const ci = (pa: number, pb: number, n: number) => 1.96 * Math.sqrt((pa * (1 - pa) + pb * (1 - pb)) / n);
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
  const row = (label: string, a: number, b: number) => `  ${label.padEnd(12)} ${pct(a).padStart(7)}  ${pct(b).padStart(7)}   ${((b - a) * 100 >= 0 ? '+' : '') + ((b - a) * 100).toFixed(1)}pt (±${(ci(a, b, games) * 100).toFixed(1)})`;
  console.log(`比較: ${base} → ${name}   ${cfg.n}人村 ${games}試合 seed ${seed0}〜${seed0 + games - 1}`);
  console.log(`  ${''.padEnd(12)} ${base.padStart(7)}  ${name.slice(0, 7).padStart(7)}   差(95%信頼区間)`);
  console.log(row('村側勝率', A.summary.villageWinRate, B.summary.villageWinRate));
  console.log(row('人狼側勝率', A.summary.wolfWinRate, B.summary.wolfWinRate));
  if (cfg.roles.includes('fox')) console.log(row('妖狐勝率', A.summary.foxWinRate, B.summary.foxWinRate));
  console.log(row('投票精度', A.summary.voteAccuracy.overall ?? 0, B.summary.voteAccuracy.overall ?? 0));
  console.log(`  平均日数     ${A.summary.avgDays.toFixed(2).padStart(7)}  ${B.summary.avgDays.toFixed(2).padStart(7)}`);
  console.log(`  異常         ${String(A.anomalies.length).padStart(7)}  ${String(B.anomalies.length).padStart(7)}`);
  console.log('\n注: 同じseedでも配役・性格は同じで、AIの判断だけが変わる。差が信頼区間より小さければ有意とは言えない。');
  console.log(`実行時間: ${((Date.now() - t0) / 1000).toFixed(1)}秒`);
  const out = get('out');
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'compare.json'), JSON.stringify({ base, variant: name, games, seed0, n: cfg.n, baseline: A.summary, candidate: B.summary }, null, 2));
    console.log(`保存: ${join(out, 'compare.json')}`);
  }
  process.exit(0);
}
const dumpPath = get('dump');
const dumpRows: string[] = [];
const runner = new BatchRunner({ games, seed0, cfg, audit: has('audit'), rules: has('rules'), variant: get('agent'), vs: get('vs'), dump: dumpPath ? (r) => { dumpRows.push(r); if (dumpRows.length >= 5000) { appendFileSync(dumpPath, dumpRows.join('\n') + '\n'); dumpRows.length = 0; } } : undefined });
if (dumpPath) writeFileSync(dumpPath, '');
while (runner.done < games) {
  runner.step(Math.max(1, Math.min(100, games - runner.done)));
  if (games >= 500 && runner.done % 500 === 0) process.stderr.write(`  ${runner.done}/${games}\n`);
}
const res = runner.finish();
if (dumpPath && dumpRows.length) appendFileSync(dumpPath, dumpRows.join('\n') + '\n');
console.log(summaryText(res));
console.log(`\n実行時間: ${((Date.now() - t0) / 1000).toFixed(1)}秒 (seed ${seed0}〜${seed0 + games - 1})`);
const out = get('out');
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'summary.json'), JSON.stringify(res.summary, null, 2));
  writeFileSync(join(out, 'games.csv'), recordsToCsv(res.records));
  writeFileSync(join(out, 'anomalies.json'), JSON.stringify(res.anomalies, null, 2));
  console.log(`保存: ${join(out, 'summary.json')}, games.csv, anomalies.json`);
}
