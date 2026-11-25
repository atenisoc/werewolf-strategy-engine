import type { GameState } from '../game/types';
import { streamRng } from '../util/rng';
import { PRESETS } from './personality';
import { RuleAgent, type AgentOpts } from './agent';
import type { Agent } from './types';
import { baseline, getVariant, type AgentVariant } from './variants';

export interface CreateAgentsOptions {
  logging?: boolean;
  // 全席に使うバリアント名(省略時 baseline)。--agent NAME
  variant?: string;
  // 席ごとのバリアント名(混合対戦用)。null/省略の席は variant に従う。--vs NAME
  seatVariants?: (string | null | undefined)[];
}

// 席ごとにAIを作る(人間の席は null)。ここは進行側のコードなので GameState を見てよいが、
// AIに渡すのは「席番号・性格・乱数列・重み」だけ。役職は渡さない(観測から知る)。
export function createAgents(state: GameState, opts: CreateAgentsOptions = {}): (Agent | null)[] {
  const base: AgentVariant = opts.variant ? getVariant(opts.variant) : baseline;
  return state.players.map((p) => {
    if (p.id === state.config.humanSeat) return null;
    const name = opts.seatVariants?.[p.id];
    const v = name ? getVariant(name) : base;
    const o: AgentOpts = {
      id: p.id,
      personality: state.personalities[p.id],
      rng: streamRng(state.seed, 'agent:' + p.id),
      weights: state.config.weights,
      behavior: state.config.behavior,
      logging: opts.logging ?? true,
    };
    return v.create(o);
  });
}

// 人間の席用のアドバイザー(ヒントボタン)。人間と同じ観測だけで考える。
export function createAdvisor(state: GameState): RuleAgent {
  const id = state.config.humanSeat ?? 0;
  return new RuleAgent({
    id,
    personality: PRESETS.analyst,
    rng: streamRng(state.seed, 'advisor'),
    weights: state.config.weights,
    behavior: state.config.behavior,
    logging: false,
  });
}
