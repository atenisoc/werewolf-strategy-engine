// 不自然さの監査: 多数の試合を回して「意識の外」の不整合を数える(npm run audit -- 300 13)
//   同日の向き変え / 同じ言い回しの重複 / 後出し判定の誤り / 死者への言及 / 人数カウントの誤り / 聞かれたのに様子見 など
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['scripts/audit.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.build/audit.mjs', logLevel: 'warning' });
const r = spawnSync(process.execPath, ['.build/audit.mjs', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
