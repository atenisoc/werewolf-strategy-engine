import { runNaturalnessAudit } from '../src/simulation/naturalness';
const N = Number(process.argv[2] ?? 300), SZ = Number(process.argv[3] ?? 13);
const r = runNaturalnessAudit(N, SZ);
console.log({ games: r.games, size: r.size, totalSay: r.totalSay, totalDays: r.totalDays });
for (const k of Object.keys(r.counts).sort()) { console.log(`${k}: ${r.counts[k]}`); for (const e of r.examples[k] ?? []) console.log('    ' + e); }
