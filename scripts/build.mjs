// ビルド: esbuild で TypeScript をまとめ、dist/ に出力する。
//   dist/index.html    … ダブルクリックで動く単一HTML(ブラウザUI)
//   dist/artifact.html … 公開ページ用(<html>/<body>タグなし)
//   dist/sim.js        … node dist/sim.js で動く自動対戦CLI
import { build, transform } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
// assets/portraits, assets/cards, assets/bg の *.webp を data URI にして src/ui/assets.gen.ts に書き出す(単一HTMLに埋め込むため)
function collect(dir) {
  if (!existsSync(dir)) return {};
  const out = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.webp')).sort()) out[f.replace(/\.webp$/, '')] = 'data:image/webp;base64,' + readFileSync(`${dir}/${f}`).toString('base64');
  return out;
}
// 立ち絵は CHARACTERS で参照されているキーだけ埋め込む(旧素材を残しても HTML が太らないように)
const usedPortraits = new Set([...readFileSync('src/game/config.ts', 'utf8').matchAll(/portrait: '([a-z0-9]+)'/g)].map((m) => m[1]));
const portraits = Object.fromEntries(Object.entries(collect('assets/portraits')).filter(([k]) => usedPortraits.has(k)));
const cards = collect('assets/cards');
const bgs = collect('assets/bg');
const events = collect('assets/events'); // 出来事の挿絵(朝・処刑・勝敗)
const nights = collect('assets/night'); // 夜の行動パネルの挿絵(占い・護衛・襲撃・作戦会議)
writeFileSync('src/ui/assets.gen.ts', `// 自動生成(scripts/build.mjs)。assets/ の画像を埋め込み用に変換したもの。直接編集しない。
export const PORTRAITS: Record<string, string> = ${JSON.stringify(portraits)};
export const CARDS: Record<string, string> = ${JSON.stringify(cards)};
export const BGS: Record<string, string> = ${JSON.stringify(bgs)};
export const EVENTS: Record<string, string> = ${JSON.stringify(events)};
export const NIGHTS: Record<string, string> = ${JSON.stringify(nights)};
`);
console.log(`assets: ${Object.keys(portraits).length} portraits, ${Object.keys(cards).length} cards, ${Object.keys(bgs).length} backgrounds, ${Object.keys(events).length} events, ${Object.keys(nights).length} nights`);
const ui = await build({ entryPoints: ['src/ui/main.ts'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none' });
const js = ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = (await transform(readFileSync('src/ui/style.css', 'utf8'), { loader: 'css', minify: true })).code;
const tpl = readFileSync('src/ui/index.template.html', 'utf8');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const favicon = readFileSync('assets/favicon.svg').toString('base64');
const full = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js)
  .replaceAll('__VERSION__', version).replaceAll('__FAVICON__', favicon)
  .replace('/*__COUNTER__*/', () => readFileSync('src/ui/counter.js', 'utf8'));
copyFileSync('assets/favicon.svg', 'dist/favicon.svg');
if (existsSync('assets/og/og.png')) copyFileSync('assets/og/og.png', 'dist/og.png');
const [headPart, bodyPart] = full.split('<!--BODY-->');
writeFileSync('dist/artifact.html', headPart + bodyPart);
writeFileSync('dist/index.html', `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n${headPart}</head>\n<body>\n${bodyPart}\n</body>\n</html>\n`);
await build({ entryPoints: ['src/simulation/sim-cli.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist/sim.js', target: 'node18', legalComments: 'none', banner: { js: '#!/usr/bin/env node' } });
console.log('built: dist/index.html, dist/artifact.html, dist/sim.js');
