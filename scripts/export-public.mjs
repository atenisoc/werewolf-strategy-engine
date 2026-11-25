// 公開リポジトリ用の書き出し: 公開してよいファイルだけを別フォルダへコピーする(allowlist方式)。
//   node scripts/export-public.mjs ../werewolf-strategy-engine
// 内部向け資料(docs/research, 依頼文, 画像生成の依頼, 調整ログ等)は含めない。
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const target = resolve(process.argv[2] ?? '../werewolf-strategy-engine');
const INCLUDE = [
  'README.md', 'README.ja.md', 'AGENTS.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md', '.gitignore',
  'package.json', 'package-lock.json', 'tsconfig.json',
  '.github', 'src', 'tests',
  'scripts/build.mjs', 'scripts/test.mjs', 'scripts/benchmark.mjs', 'scripts/audit.mjs', 'scripts/audit.ts', 'scripts/tune.mjs',
  'scripts/equilibrium.sh', 'scripts/learn.py', 'scripts/classify_log.mjs', 'scripts/preview.mjs', 'scripts/export-public.mjs',
  'assets/portraits', 'assets/cards', 'assets/bg', 'assets/events', 'assets/night', 'assets/og', 'assets/favicon.svg',
  'docs/architecture.md', 'docs/game-rules.md', 'docs/reasoning.md', 'docs/strategy.md', 'docs/role-strategies.md',
  'docs/extension-guide.md', 'docs/benchmark.md', 'docs/limitations.md', 'docs/roadmap.md', 'docs/glossary.md',
  'docs/images',
];
const EXCLUDE_IN_SRC = ['src/ui/assets.gen.ts']; // ビルドで再生成される(数MB)

if (existsSync(target)) {
  // 既存の .git は残し、それ以外を消してから書き出す
  for (const e of readdirSync(target)) if (e !== '.git') rmSync(join(target, e), { recursive: true, force: true });
} else mkdirSync(target, { recursive: true });

let files = 0;
const count = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((s, e) => s + count(join(p, e)), 0) : 1);
for (const rel of INCLUDE) {
  if (!existsSync(rel)) { console.warn('skip (missing):', rel); continue; }
  cpSync(rel, join(target, rel), { recursive: true, filter: (src) => !EXCLUDE_IN_SRC.some((x) => resolve(src) === resolve(x)) });
  files += count(join(target, rel));
}
console.log(`exported ${files} files to ${target}`);
