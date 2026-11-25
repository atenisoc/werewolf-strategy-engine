// 村側推理の重み(belief.ts の W)を、村側勝率を目的関数にして座標降下で調整する。
//   node scripts/tune.mjs --n 13 --games 1500 --passes 2 --keys lateChange,lynchBlackVoter,...
//   node scripts/tune.mjs --target tune --objective wolf --extra "--wolfFake 0.85"   (人狼側の数値を人狼勝率で調整)
// 同じ seed 列で比較する(共通乱数)ので、差が小さくても比較のノイズは抑えられる。
// 結果は tune-result.json に保存。採用するかは人が判断する(勝率が上がっても不自然なら不採用)。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const n = get('n', '13');
const games = get('games', '1500');
const passes = Number(get('passes', '2'));
const seed = get('seed', '1');
const minGain = Number(get('minGain', '0.01')); // 採用に必要な勝率の改善(1pt)
const target = get('target', 'w'); // w=村側の重み(belief.ts W) / tune=人狼側の数値(flags.ts TUNE_DEFAULTS)
const objective = get('objective', target === 'w' ? 'village' : 'wolf'); // 目的: village / wolf の勝率
const extra = (get('extra', '')).split(' ').filter(Boolean); // sim.js に渡す追加引数(例: "--wolfFake 0.85")
const keys = (get('keys', target === 'tune' ? 'kakoiP,mateWhiteP,seerAttackW,seerHoldW,mediumBiteW,hunterAttackW,trustAttackW,counterBlackP,fakeBlackP,matesCutHeat,guardedW' : 'lateChange,lynchBlackVoter,lynchWhiteVoter,defendBlack,accuseTrusted,accuseSame,silent,seerBlack,seerWhite,fakeSeer,fakeReverse,seerVotePenalty,hunterTrust,matchGain,compPow')).split(',');
const factors = (get('factors', '0,0.5,1.5,2')).split(',').map(Number);

// 人数別の上書き(TUNE_BY_N)があれば、その人数の現在値を基準にする
const BY_N = target === 'tune' ? (() => { const s = readFileSync('src/agents/flags.ts', 'utf8'); const m = s.match(/export const TUNE_BY_N[^=]*= (\{[\s\S]*?\n\});/); const o = m ? eval('(' + m[1] + ')') : {}; return o[Number(n)] ?? {}; })() : {};
const DEFAULT0 = JSON.parse(execFileSync('node', ['-e', `
  const s = require('fs').readFileSync(${JSON.stringify(target === 'w' ? 'src/agents/belief.ts' : 'src/agents/flags.ts')},'utf8');
  const m = s.match(${target === 'w' ? '/export const W = \\{([\\s\\S]*?)\\n\\};/' : '/export const TUNE_DEFAULTS[^=]*= \\{([\\s\\S]*?)\\n\\};/'})[1];
  const o = {}; for (const line of m.split('\\n')) { const mm = line.match(/^\\s*(\\w+):\\s*(-?[\\d.]+)/); if (mm) o[mm[1]] = Number(mm[2]); }
  console.log(JSON.stringify(o));`]).toString());
const DEFAULT = { ...DEFAULT0, ...BY_N };

const dir = mkdtempSync(join(tmpdir(), 'tune-'));
function evaluate(w) {
  const wArg = Object.entries(w).map(([k, v]) => `${k}=${v}`).join(',');
  execFileSync('node', ['dist/sim.js', '--n', n, '--games', games, '--seed', seed, target === 'w' ? '--w' : '--tune', wArg, '--out', dir, ...extra], { stdio: 'ignore' });
  const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  return { win: objective === 'wolf' ? s.wolfWinRate : s.villageWinRate, auc: s.rankAuc };
}

let cur = { ...DEFAULT };
let best = evaluate(cur);
const side = objective === 'wolf' ? '人狼側' : '村側';
const log = [`baseline: ${side} ${(best.win * 100).toFixed(1)}%  AUC ${(best.auc * 100).toFixed(1)}%`];
console.log(log[0]);
for (let pass = 0; pass < passes; pass++) {
  for (const k of keys) {
    if (!(k in cur)) { console.log(`  (skip ${k}: W にない)`); continue; }
    const base = cur[k];
    let bestVal = base;
    for (const f of factors) {
      const v = Math.round(base * f * 100) / 100;
      if (v === base) continue;
      const r = evaluate({ ...cur, [k]: v });
      const line = `  pass${pass + 1} ${k}: ${base} → ${v}  ${side} ${(r.win * 100).toFixed(1)}%  AUC ${(r.auc * 100).toFixed(1)}%${r.win >= best.win + minGain ? '  ★' : ''}`;
      console.log(line); log.push(line);
      if (r.win >= best.win + minGain) { best = r; bestVal = v; }
    }
    if (bestVal !== base) { cur[k] = bestVal; const l = `  採用: ${k} = ${bestVal} (${side} ${(best.win * 100).toFixed(1)}%)`; console.log(l); log.push(l); }
  }
}
const changed = Object.fromEntries(Object.entries(cur).filter(([k, v]) => v !== DEFAULT[k]));
const out = { n: Number(n), games: Number(games), seed: Number(seed), baseline: DEFAULT, tuned: cur, changed, result: best, log };
writeFileSync('tune-result.json', JSON.stringify(out, null, 2));
console.log(`\n変更: ${JSON.stringify(changed)}\n最終: ${side} ${(best.win * 100).toFixed(1)}%  AUC ${(best.auc * 100).toFixed(1)}%  → tune-result.json`);
