# Roadmap

What exists today is a complete, playable, measurable engine. The items below are *not* implemented; they are the directions we think are most valuable, roughly in order. Pick one, open an issue to say you are on it, and measure.

## Near term (good first contributions)

- **More variants under `src/agents/variants/`.** Any measured strategy, better or worse, with its `--compare` output. See [extension-guide.md](extension-guide.md).
- **English speech templates.** Statements are structured; a second template set in [`src/actions/templates.ts`](../src/actions/templates.ts) plus a language switch would make the browser game playable in English without touching the AI.
- **English code comments** for `belief.ts`, `candidates.ts`, `werewolf.ts` (the three files newcomers read first).
- **Rule variants from the research notes:** public-result medium (言霊術師), no-execution on tie with a double bite (大食い), alternate-night seer (隔日占い), peaceful-first-night 13-player roster. Each is an engine flag plus a small belief change; each should ship as a preset so the default balance is unchanged.
- **Rope counter in the UI** (how many wrong executions the village can still afford).
- **Paired-difference statistics** for `--compare` (same seeds → paired test), replacing the current conservative interval.

## Medium term

- **Set-constraint reasoning.** Represent "at least one of {A,B} is a wolf" and propagate it. Needed for several rule variants and a real step up in inference.
- **Opponent modelling.** Let a village strategy adapt to the observed claim pattern instead of fixed `TUNE_BY_N` knobs.
- **Human-log comparison.** `scripts/classify_log.mjs` maps human game logs onto the engine's statement kinds; the next step is scoring the engine's ledger on human games (which statements preceded a correct vote?) and publishing a comparison.
- **Split `belief.ts`** into observation history / claim verification / suspicion aggregation / effective reasons, as suggested in review, without changing any output (the reproducibility test is the guard).

## Research directions

- **Alternative agents behind the same interface:** a Bayesian agent over role assignments, a Monte-Carlo agent, an LLM-backed agent. The `Agent` interface and `--vs` are designed for exactly this comparison.
- **Reinforcement learning on the candidate scorer.** The decision step is a linear scorer over a small candidate set with an explicit rule term; it is a natural place for a learned policy that keeps explainability.
- **Explainable-AI studies.** Every decision is already logged with its reasons; the UI shows them to the player. A study of whether those explanations help humans play better is possible with the existing build.
- **Balance search across rosters.** `scripts/equilibrium.sh` is a crude alternating best-response loop; a proper game-theoretic treatment of roster balance would be new.

## Not planned

- A server, accounts, or multiplayer. This is an engine and a single-file client.
- Natural-language input.
