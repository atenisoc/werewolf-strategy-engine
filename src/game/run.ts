import { createAgents, type CreateAgentsOptions } from '../agents/factory';
import type { Agent } from '../agents/types';
import { runToEnd, type GameResult, type Hooks } from './engine';
import { createState } from './state';
import type { GameConfig, GameState } from './types';

// seed と config から AI だけの1試合を再現する(UIの再生・デバッグ・大量対戦で共通利用)。
export function runAiGame(seed: number, cfg: GameConfig, opts: { logging?: boolean; hooks?: Hooks; variant?: string; seatVariants?: CreateAgentsOptions['seatVariants'] } = {}): { state: GameState; agents: (Agent | null)[]; result: GameResult } {
  const state = createState(seed, { ...cfg, humanSeat: null });
  const agents = createAgents(state, { logging: opts.logging ?? true, variant: opts.variant, seatVariants: opts.seatVariants });
  const result = runToEnd(state, agents, opts.hooks);
  return { state, agents, result };
}
