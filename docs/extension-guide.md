# Extension guide: add your own strategy and prove it is better

This is the workflow the project is built around:

```
clone → write a variant → run the same 1000+ seeds against the baseline → read the difference → open a PR
```

Nothing in the baseline AI changes when you add a variant. Variants are registered by name and selected on the command line, so the shipped behaviour, the browser game and the tests keep working while you experiment.

## 0. Setup (3 minutes)

```bash
git clone https://github.com/atenisoc/werewolf-strategy-engine.git
cd werewolf-strategy-engine
npm install          # esbuild + typescript only
npm run build        # → dist/sim.js (CLI) and dist/index.html (browser game)
npm test             # 22 tests, ~1 min
node dist/sim.js --n 9 --games 200
```

## 1. The three places you can plug in

| You want to change… | Mechanism | Where |
|---|---|---|
| How much a piece of evidence counts | override entries of the `W` weight table | `behavior.w` on the agent options (or `--w key=val` on the CLI for quick trials) |
| What a role says, votes or does at night | a `RoleStrategy` object with any of the hooks | `strategies: { villager: myVillager }` on the agent options |
| Everything (a different reasoning model) | implement the `Agent` interface yourself | `create()` returns your class |

All three are expressed through one object, an `AgentVariant`:

```ts
// src/agents/variants/my-variant.ts
import { RuleAgent } from '../agent';
import type { AgentVariant } from './index';
import type { RoleStrategy } from '../types';

const myVillager: RoleStrategy = {
  talkExtras(ctx) {
    // return extra speech candidates; see candidates.ts for the shape and the existing kinds
    return [];
  },
};

export const myVariant: AgentVariant = {
  name: 'my-variant',
  description: 'one line shown by --variants',
  create: (o) => new RuleAgent({
    ...o,
    behavior: { ...o.behavior, w: { ...(o.behavior.w ?? {}), seerWhite: 40 } },
    strategies: { villager: myVillager },
  }),
};
```

Register it in [`src/agents/variants/index.ts`](../src/agents/variants/index.ts):

```ts
import { myVariant } from './my-variant';
export const VARIANTS = { baseline, [exampleSkeptic.name]: exampleSkeptic, [myVariant.name]: myVariant };
```

The shipped [`example-skeptic.ts`](../src/agents/variants/example-skeptic.ts) is a complete, commented example of both mechanisms.

## 2. Run the comparison

```bash
npm run build
node dist/sim.js --variants                                  # lists what is registered
node dist/sim.js --compare my-variant --n 13 --games 2000    # same seeds, all seats baseline vs all seats my-variant
node dist/sim.js --vs my-variant --n 13 --games 2000         # mixed village: both AIs in the same games
node dist/sim.js --agent my-variant --replay 42 --think      # watch one game in detail
```

`--compare` prints:

```
比較: baseline → my-variant   13人村 2000試合 seed 1〜2000
               baseline  my-vari   差(95%信頼区間)
  村側勝率           46.9%    49.3%   +2.4pt (±3.1)
  人狼側勝率          53.1%    50.7%   -2.4pt (±3.1)
  投票精度           45.4%    46.1%   +0.7pt (±3.1)
  平均日数        5.37     5.31
  異常               0        0
```

Because the seeds are identical, both runs get the same role assignments and personalities; only the AI's decisions differ. The interval is a normal approximation on the difference of two proportions — if the difference is inside it, you have not shown anything yet; run more games (`--games 5000`) or accept the null result.

`--vs` puts the two variants into the *same* village on alternating seats (swapped on odd seeds, so over many games both get the same mix of roles) and reports per-variant win rate when on the village side, when on the wolf side, and vote accuracy. This answers "is my villager better than the baseline villager in the same game?" rather than "is a village of my agents better?".

`--out DIR` writes `compare.json` / `summary.json` / `games.csv` for your own analysis.

## 3. What to look at besides the win rate

- `--rules` on a normal run prints per-rule hit rates. If you added a rule, this is where you see whether it points at wolves more often than chance (compare "hit rate" to "wolf share").
- The naturalness audit: `npm run audit -- 300 13` — a strategy that wins by talking nonsense (contradicting itself within a day, repeating phrases) will show up here, and the test suite has thresholds for it.
- Both camps and several sizes. A village-side change should be checked at 7, 9 and 13 at least; a wolf-side change at 9, 13 and 15. The equilibria differ ([strategy.md](strategy.md)).
- `--off <flag>` and `--tune key=val` let you measure one existing rule or knob without writing any code (`--flags` lists them).

## 4. Changing the baseline itself

If your variant wins and you think it should become the default:

1. Move the change into the baseline code (`belief.ts` weights, `roles/*.ts`, `candidates.ts`…).
2. Keep the comment next to the changed weight honest: what you measured, on how many games, at which sizes.
3. If a weight changes, re-check `TUNE_BY_N` — the wolves' best response may change too (`scripts/equilibrium.sh`).
4. `npm test`. The leak test, the reproducibility test and the naturalness thresholds must pass unchanged.
5. In the PR, paste the `--compare` output for each size you tested.

## 5. Adding a new kind of statement

Speech is structured ([`src/game/types.ts`](../src/game/types.ts) `StatementKind`). To add one: extend the union, add validation in [`src/actions/statement.ts`](../src/actions/statement.ts), add Japanese templates in [`src/actions/templates.ts`](../src/actions/templates.ts), generate it as a candidate, and — if other agents should react to it — handle it in `Belief.update()`. The test "新しい発言…が形式チェックを通り、実際に使われる" shows the pattern.

## 6. Adding a role or a preset

See the last section of [role-strategies.md](role-strategies.md). Presets are plain arrays in [`src/game/config.ts`](../src/game/config.ts); a new preset only needs the roster and, if balance differs, an entry in `TUNE_BY_N`.

## 7. Replacing the reasoning model entirely

`Agent` ([`src/agents/types.ts`](../src/agents/types.ts)) is five methods: `talk`, `vote`, `night`, `wolfPlan`, plus `suspicions()` / `ledger()` for the statistics (return `null` if you have none). The observation you receive is documented in [`src/observations/observation.ts`](../src/observations/observation.ts). Return a valid `Statement` and the engine validates it; anything invalid throws, which the batch runner records as an anomaly. A Bayesian or search-based agent, or an LLM-backed one, fits this interface and can be benchmarked with the same `--compare` / `--vs` commands — that comparison is one of the things we would most like to see.

## 8. Contributing

- Variants under `src/agents/variants/` are welcome as PRs even if they are *not* better — a well-measured negative result with its `--compare` output is useful.
- Please keep comments next to measurements. Japanese or English are both fine.
- See [CONTRIBUTING.md](../CONTRIBUTING.md).
