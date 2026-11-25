# Contributing

Thanks for looking. The project exists so that people can write better Werewolf strategies and measure them; contributions of every size are welcome, and Japanese or English are both fine for issues, PRs and comments.

## Ways to contribute

| Kind | Where to start |
|---|---|
| A new strategy or rule | [docs/extension-guide.md](docs/extension-guide.md) — add a variant under `src/agents/variants/`, run `--compare`, open a PR with the output |
| A change to the baseline AI | same, then move it into the baseline once it measures better; update the comment next to the weight you changed |
| A measurement, a bug in the stats, a new metric | `src/simulation/` |
| A rule variant (preset) | `src/game/config.ts`, `src/game/engine.ts`; keep the default presets' behaviour unchanged |
| Translation (speech templates, docs, comments) | `src/actions/templates.ts`, `docs/`, any file |
| A negative result | also welcome — a variant that does *not* help, with numbers, saves the next person a week |

Issues labelled **good first issue** are sized for a first PR.

## Before you open a PR

```bash
npm run build && npm test          # must pass; the leak test and reproducibility test are non-negotiable
npm run typecheck                  # tsc --noEmit
node dist/sim.js --compare <your-variant> --n 13 --games 2000   # paste the output into the PR
```

- Keep the baseline deterministic: never call `Math.random()`; use the `rng` you are given.
- Never read `GameState` from agent code. If you need new private information for a role, add it to `PlayerObservation.priv` in `buildObservation()` and nowhere else.
- One behavioural change per PR, with the sizes you measured (7 / 9 / 13 at least for village-side changes).
- If you change a weight in `belief.ts`, update its comment: what you measured, how many games.
- Don't reformat files you are not changing.

## Reporting a bug

Use the bug template. A seed and player count that reproduce it (`node dist/sim.js --n 13 --replay <seed> --think`) make it fixable in minutes; a browser game can be reproduced from its replay code (settings → 再現コード).

## Code of conduct

Be kind, assume good faith, argue with numbers.
