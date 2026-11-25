import { createAdvisor, createAgents } from '../agents/factory';
import type { RuleAgent } from '../agents/agent';
import type { Agent } from '../agents/types';
import { playGame, type GameResult, type HumanRequest, type HumanResponse } from './engine';
import { createState } from './state';
import type { GameConfig, GameState } from './types';

// UI用の対戦セッション。人間の入力待ち(pending)を管理し、入力履歴(inputs)を記録する。
// seed + config + inputs があれば、人間が参加した試合もそのまま再生できる。
export class Session {
  state: GameState;
  agents: (Agent | null)[];
  advisor: RuleAgent | null;
  pending: HumanRequest | null = null;
  result: GameResult | null = null;
  inputs: HumanResponse[] = [];
  error: string | null = null;
  private gen: ReturnType<typeof playGame>;
  private replay: HumanResponse[];

  constructor(seed: number, cfg: GameConfig, replayInputs: HumanResponse[] = []) {
    this.state = createState(seed, cfg);
    this.agents = createAgents(this.state, { logging: true });
    this.advisor = cfg.humanSeat != null ? createAdvisor(this.state) : null;
    this.replay = [...replayInputs];
    this.gen = playGame(this.state, this.agents);
    this.advance(() => this.gen.next());
  }

  respond(r: HumanResponse) {
    if (!this.pending) return;
    this.inputs.push(r);
    this.advance(() => this.gen.next(r));
  }

  private advance(first: () => IteratorResult<HumanRequest, GameResult>) {
    try {
      let r = first();
      for (;;) {
        if (r.done) {
          this.result = r.value;
          this.pending = null;
          return;
        }
        if (this.replay.length) {
          const x = this.replay.shift() as HumanResponse;
          this.inputs.push(x);
          r = this.gen.next(x);
          continue;
        }
        this.pending = r.value;
        return;
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.pending = null;
    }
  }

  get finished(): boolean {
    return this.result != null || this.error != null;
  }
}
