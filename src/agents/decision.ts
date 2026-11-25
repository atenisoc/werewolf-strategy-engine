import type { Personality, ScoreWeights } from '../game/types';
import type { ThinkCandidate } from '../logs/think';
import type { Rng } from '../util/rng';
import { personalityScore } from './personality';
import type { Cand } from './types';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export interface Scored {
  cand: Cand;
  info: ThinkCandidate;
}

// 候補ごとのスコア = ルール(約75%) + 性格(約15%) + 乱数(約10%)
// 乱数の比率は性格のnoiseで 5〜15% 程度の範囲で上下する。
export function scoreCands(cands: Cand[], p: Personality, w: ScoreWeights, rng: Rng, noNoise: boolean, noiseBoost = 1): { scored: Scored[]; best: Scored } {
  const nz = w.noise * (0.5 + p.noise / 100) * noiseBoost;
  const tot = w.rule + w.personality + nz;
  const wr = w.rule / tot;
  const wp = w.personality / tot;
  const wn = nz / tot;
  const scored: Scored[] = cands.map((c) => {
    const rule = wr * clamp(c.rule, 0, 100);
    const pers = wp * personalityScore(p, c.pers, c.heat);
    const noise = wn * (noNoise ? 50 : rng() * 100);
    return { cand: c, info: { label: c.label, rule, personality: pers, noise, total: rule + pers + noise } };
  });
  // must 付きの候補があれば、その中からだけ選ぶ(役職者が結果を言わずに別の話をするのを防ぐ)
  const pool = scored.some((s) => s.cand.must) ? scored.filter((s) => s.cand.must) : scored;
  let best = pool[0];
  for (const s of pool) if (s.info.total > best.info.total) best = s;
  return { scored, best };
}
