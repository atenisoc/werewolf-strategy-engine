// テスト実行: tests/tests.ts をまとめて node で実行する
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['tests/tests.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.build/tests.mjs', logLevel: 'warning' });
const r = spawnSync(process.execPath, ['.build/tests.mjs'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
