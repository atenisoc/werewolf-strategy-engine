// 再現可能なベンチマーク: 人数ごとに同じseed群でAI同士を対戦させ、docs/benchmark.md の表を生成する。
//   node scripts/benchmark.mjs [--games 2000] [--seed 7001] [--out bench]
// 事前に `npm run build` が必要(dist/sim.js を使う)。
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, platform, release, arch } from 'node:os';

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const games = Number(get('games', '2000'));
const seed = Number(get('seed', '7001'));
const out = get('out', 'bench');
mkdirSync(out, { recursive: true });

const pct = (x) => (x == null ? '-' : (x * 100).toFixed(1) + '%');
const rows = [];
for (const n of [5, 7, 9, 13, 15]) {
  const dir = join(out, `n${n}`);
  const t0 = Date.now();
  execFileSync(process.execPath, ['dist/sim.js', '--n', String(n), '--games', String(games), '--seed', String(seed), '--out', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
  const sec = (Date.now() - t0) / 1000;
  const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  const an = JSON.parse(readFileSync(join(dir, 'anomalies.json'), 'utf8'));
  rows.push({ n, s, sec, anomalies: an.length });
}

const L = [];
L.push(`| Players | Roles | Village | Werewolf | Fox | Avg days | Vote acc. | Rank AUC | Anomalies | Time (${games} games) |`);
L.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) {
  const counts = {};
  for (const x of r.s.config.roles) counts[x] = (counts[x] ?? 0) + 1;
  const roles = Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(' ');
  L.push(`| ${r.n} | ${roles} | ${pct(r.s.villageWinRate)} | ${pct(r.s.wolfWinRate)} | ${r.s.config.roles.includes('fox') ? pct(r.s.foxWinRate) : '-'} | ${r.s.avgDays.toFixed(2)} | ${pct(r.s.voteAccuracy.overall)} | ${r.s.rankAuc == null ? '-' : pct(r.s.rankAuc)} | ${r.anomalies} | ${r.sec.toFixed(1)}s |`);
}
L.push('');
L.push('Role survival rate at game end (village-side roles):');
L.push('');
L.push('| Players | ' + ['villager', 'seer', 'medium', 'hunter', 'mason', 'werewolf', 'madman', 'fox'].join(' | ') + ' |');
L.push('|---:|' + '---:|'.repeat(8));
for (const r of rows) L.push(`| ${r.n} | ` + ['villager', 'seer', 'medium', 'hunter', 'mason', 'werewolf', 'madman', 'fox'].map((k) => (r.s.roleSurvival[k] ? pct(r.s.roleSurvival[k].rate) : '-')).join(' | ') + ' |');
L.push('');
L.push(`Environment: Node ${process.version}, ${platform()} ${release()} ${arch()}, ${cpus()[0]?.model ?? 'unknown CPU'} × ${cpus().length}. Seeds ${seed}–${seed + games - 1}. Command: \`node dist/sim.js --n N --games ${games} --seed ${seed}\`.`);
const md = L.join('\n');
writeFileSync(join(out, 'benchmark-table.md'), md);
console.log(md);
