import type { Personality } from '../game/types';
import type { Rng } from '../util/rng';

// 性格は 0〜100 の4パラメータだけ。プリセットは単なる値の組み合わせ。
//  aggression: 他人を疑いやすい / 強い発言をしやすい
//  trust     : 他人を信用しやすい / かばいやすい
//  follow    : 多数派に追従しやすい
//  noise     : 判断のランダム性
export const PRESETS: Record<string, Personality> = {
  cautious: { key: 'cautious', name: '慎重型', aggression: 25, trust: 45, follow: 40, noise: 25 },
  aggressive: { key: 'aggressive', name: '攻撃型', aggression: 80, trust: 35, follow: 25, noise: 35 },
  follower: { key: 'follower', name: '追従型', aggression: 40, trust: 55, follow: 85, noise: 25 },
  analyst: { key: 'analyst', name: '分析型', aggression: 50, trust: 40, follow: 15, noise: 10 },
  moody: { key: 'moody', name: '気分屋', aggression: 55, trust: 50, follow: 50, noise: 85 },
  // 第18版で追加: 村の性格の幅を広げる(勝率への影響は人数別に確認済み)
  quiet: { key: 'quiet', name: '寡黙型', aggression: 30, trust: 55, follow: 60, noise: 20 },
  leader: { key: 'leader', name: '仕切り型', aggression: 65, trust: 40, follow: 10, noise: 15 },
};
export const PRESET_ORDER = ['cautious', 'aggressive', 'follower', 'analyst', 'moody', 'quiet', 'leader'];

const clamp100 = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

// プリセットから±amtだけ個体差を付ける(同じ性格でも少しずつ違う)
export function jitter(p: Personality, rng: Rng, amt = 12): Personality {
  const j = () => (rng() * 2 - 1) * amt;
  return {
    key: p.key,
    name: p.name,
    aggression: clamp100(p.aggression + j()),
    trust: clamp100(p.trust + j()),
    follow: clamp100(p.follow + j()),
    noise: clamp100(p.noise + j()),
  };
}

export type PersKind = 'accuse' | 'defend' | 'agree' | 'wait' | 'vote' | 'neutral';

// 性格によるスコア(0〜100)。「どの行動を好むか」だけを表す。
export function personalityScore(p: Personality, kind: PersKind, heat: number): number {
  let s: number;
  switch (kind) {
    case 'accuse':
      s = 0.8 * p.aggression + 0.5 * p.follow * heat;
      break;
    case 'defend':
      s = 0.8 * p.trust + 0.2 * (100 - p.aggression);
      break;
    case 'agree':
      s = 0.7 * p.follow + 0.3 * p.trust;
      break;
    case 'wait':
      s = 0.7 * (100 - p.aggression) + 0.3 * (100 - p.follow);
      break;
    case 'vote':
      s = p.follow * heat * 0.9 + p.aggression * 0.1;
      break;
    default:
      s = 50;
  }
  return Math.max(0, Math.min(100, s));
}

export function toneOf(p: Personality): 'polite' | 'plain' | 'strong' {
  return p.aggression >= 65 ? 'strong' : p.aggression <= 35 ? 'polite' : 'plain';
}
