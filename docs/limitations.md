# Known limitations

Honest list, so that nobody mistakes this for more than it is.

## Reasoning

- **Additive suspicion, no joint inference.** Each player gets an independent 0–100 score. The model cannot represent "either A or B is a wolf, not both" except through ad-hoc rules (claim counts, rival claimants). Set constraints such as "the pair {A, B} contains a wolf" are not representable at all.
- **Rules are hand-written; only magnitudes are learned.** The logistic-regression calibration ([reasoning.md](reasoning.md) §4) adjusts the weight of each rule per player count; it cannot invent a rule, and it was fitted on self-play, so it calibrates the AI to its own opponents.
- **Self-play balance ≠ strength.** All win rates are AI vs AI. The village is roughly balanced at 7–13 players and under-balanced at 15 (40 % village, 18 % fox). There is no measurement against humans.
- **Speech carries no new information.** Agents reason over the structured statement, and statements are chosen *from* the belief, so a statement is a (noisy) readout of a suspicion vector. Persuasion, bluffing through tone, and reading tone are absent. The dialects are decoration.
- **Day-1 play is thin.** With no evidence, day-1 votes are mostly first impressions and claim-timing cues; 9+ player games start with an uninformed execution.
- **The madman is simple.** It fakes a claim and attacks the most credible rival; it does not coordinate with the wolves beyond what any observer could infer.

## Rules and scope

- One rule set: Japanese standard (no "no-lynch" option, runoff then random tie-break, seer on night 0). Variants from the research notes (public medium, no-execution tie, alternate-night seer…) are not implemented yet.
- Fixed presets (5/7/9/13/15). Any roster works mechanically, but the balance knobs (`TUNE_BY_N`) exist only for those five.
- Japanese-only text. The UI and all speech templates are Japanese; the statement *structure* is language-independent, so a translation is a template job, not an AI job — see [roadmap.md](roadmap.md).

## Engineering

- Code comments are in Japanese. The documents in `docs/` are in English and link to the source; the [glossary](glossary.md) covers the jargon.
- `belief.ts` (≈900 lines) and `ui/main.ts` (≈1100 lines) are the two files that have grown past comfortable size. A split (observation history / claim verification / scoring / effective reasons) was recommended in a code review and is on the roadmap.
- The single-file browser build embeds all images and is about 3 MB; fine for a static host, large for a slow connection.
- No TypeScript project references, no linter configured; `tsc --noEmit` and the tests are the only gates.
- Reproducibility is per version: a seed replays the same game only on the same code. There is no versioned replay format.
- Statement validation checks kinds and targets but not every semantic combination; a hand-crafted invalid statement from custom code throws rather than being rejected gracefully.

## Measurement

- Rule hit rates count ledger entries; a rule with weight 0 leaves no ledger entry and therefore cannot be measured without re-enabling it.
- The hunter guard-report check is 100 % accurate *against the current AI's fake behaviour*; it says nothing about how well it would detect a human's creative lie.
- `--compare` uses a normal approximation on paired runs without accounting for the pairing, so its interval is conservative (wider than necessary).
