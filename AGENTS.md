# Guide for AI coding assistants (and humans in a hurry)

This file is for Copilot / Cursor / Claude Code / Codex and similar tools. It tells you where things are, what not to break, and how to prove a change is good. Everything here is also in `docs/`, in more detail.

## What this repository is

A rule-based Werewolf (Mafia) AI engine in TypeScript. No LLM, no network, no runtime dependencies. Every player is a `RuleAgent` that keeps a 0–100 suspicion per other player (`src/agents/belief.ts`), picks a structured `Statement` from candidates (`src/agents/candidates.ts`), and is scored `0.75·rule + 0.15·personality + 0.10·noise` (`src/agents/decision.ts`). The engine (`src/game/engine.ts`) is a generator; a seed reproduces a game bit-for-bit.

Code comments are Japanese. `docs/glossary.md` maps the jargon (白/黒 = seer result human/wolf, CO = role claim, 騙り = fake claim, 囲い = fake white on a mate, 吊り = execution, 噛み = bite).

## Commands

```bash
npm ci                 # esbuild + typescript only
npm run build          # dist/sim.js (CLI) + dist/index.html (browser game)
npm test               # 22 tests (~1 min). Must stay green.
npm run typecheck
node dist/sim.js --help
node dist/sim.js --n 13 --games 1000                      # batch stats
node dist/sim.js --n 9 --replay 42 --think                # one game with reasoning logs
node dist/sim.js --compare <variant> --n 13 --games 2000  # same seeds, baseline vs variant, with 95% CI
node dist/sim.js --vs <variant> --n 13 --games 2000       # both variants in the same village
node dist/sim.js --flags                                  # rule switches (--off) and knobs (--tune)
```

## Where to make which change

| Task | Files |
|---|---|
| New strategy to experiment with (preferred for most contributions) | add `src/agents/variants/<name>.ts`, register in `src/agents/variants/index.ts`. Template: `example-skeptic.ts` |
| Change how evidence is weighted | `W` table at the top of `src/agents/belief.ts` (update the comment with what you measured) |
| Change what a role says / votes / does at night | `src/agents/roles/<role>.ts` (hooks in `RoleStrategy`, `src/agents/types.ts`) |
| New kind of statement | `StatementKind` in `src/game/types.ts` → validate in `src/actions/statement.ts` → templates in `src/actions/templates.ts` → generate in `candidates.ts` → react in `belief.ts` |
| New role | `src/game/roles.ts` + `src/agents/roles/` + `buildObservation()` if it has private info |
| New preset / rule variant | `src/game/config.ts`, `src/game/engine.ts` (keep default presets unchanged) |
| Metrics | `src/simulation/batch.ts`, `report.ts` |
| Browser UI | `src/ui/main.ts`, `index.template.html`, `style.css` (Japanese UI) |

## Hard rules (tests enforce the first three)

1. Agent code reads **only** `PlayerObservation` (`src/observations/observation.ts`). Never import or touch `GameState` from `src/agents/`. The only place allowed to read a true role is `buildObservation()`, and only the observer's own.
2. Never call `Math.random()`. Use the `rng` passed in (`src/util/rng.ts`). Logging must not consume randomness.
3. The baseline (`variant: 'baseline'`) must stay bit-identical unless the change is intentionally a baseline change — then say so in the PR and paste `--compare` output.
4. Don't reformat files you aren't changing. Keep comments next to weights honest (what was measured, how many games).
5. A fake claimant must stay consistent with its own claim (`src/agents/viewpoint.ts`); don't bypass that layer.

## How to prove a change

Run `--compare` at 7, 9 and 13 players (add 15 for wolf/fox changes) with ≥2000 games and read the confidence interval; a difference inside the interval is not a result. Then `npm test` (reproducibility, leak audit and the naturalness thresholds must pass). See `docs/extension-guide.md` and `docs/strategy.md`.

## Docs map

`docs/architecture.md` (modules, diagrams) · `docs/reasoning.md` (the suspicion model and rules) · `docs/strategy.md` (why the AI plays this way, measurement method) · `docs/role-strategies.md` · `docs/extension-guide.md` · `docs/benchmark.md` · `docs/limitations.md` · `docs/roadmap.md` · `docs/glossary.md`.
