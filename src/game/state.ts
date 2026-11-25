import { PRESETS, PRESET_ORDER, jitter } from '../agents/personality';
import { NAMES } from './config';
import type { GameConfig, GameState, Personality, Player } from './types';
import { streamRng } from '../util/rng';

// seedとconfigだけから初期状態が完全に決まる(役職配置・性格・以降の乱数列)。
export function createState(seed: number, cfg: GameConfig): GameState {
  const setup = streamRng(seed, 'setup');
  const roles = setup.shuffle([...cfg.roles]);
  // 人間の役職指定: 指定された役職を持つ最初の席と入れ替える(seedによる配役の再現性は保つ)
  if (cfg.humanSeat != null && cfg.humanRole && roles[cfg.humanSeat] !== cfg.humanRole) {
    const j = roles.indexOf(cfg.humanRole);
    if (j >= 0) [roles[cfg.humanSeat], roles[j]] = [roles[j], roles[cfg.humanSeat]];
  }
  const prng = streamRng(seed, 'persona');
  const players: Player[] = [];
  const personalities: Personality[] = [];
  for (let i = 0; i < cfg.n; i++) {
    const drawn = PRESET_ORDER[prng.int(PRESET_ORDER.length)];
    const key = cfg.personalities?.[i] && PRESETS[cfg.personalities[i]] ? cfg.personalities[i] : drawn;
    players.push({ id: i, name: NAMES[i], role: roles[i], alive: true, personalityKey: key });
    personalities.push(jitter(PRESETS[key], prng));
  }
  return {
    seed,
    config: cfg,
    players,
    personalities,
    day: 0,
    phase: 'night',
    events: [],
    notes: [],
    priv: { seer: {}, executed: [], guard: {}, wolfChat: [] },
    winner: null,
    rng: streamRng(seed, 'game'),
  };
}
