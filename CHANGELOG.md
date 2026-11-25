# Changelog

## 0.3.0 — 2026-11 (first open-source release)

- Pluggable agent variants: `src/agents/variants/` registry, `AgentOpts.strategies` for per-role strategy override, `createAgents({ variant, seatVariants })`.
- CLI: `--agent NAME`, `--vs NAME` (mixed village, per-variant stats), `--compare NAME` (same seeds, difference with 95 % interval), `--variants`.
- `scripts/benchmark.mjs` regenerates the benchmark table.
- English documentation set under `docs/` (architecture, game rules, reasoning, strategy, role strategies, extension guide, benchmark, limitations, roadmap, glossary).
- Test: variant registry leaves the baseline bit-identical; mixed villages pass the leak audit (22 tests).
- No change to the baseline AI's behaviour or to the browser game logic.

## 0.2.0 — 2026-10

- Viewpoint-consistency layer for all claimants (real or fake).
- Hunter guard-report check (判定チェック); medium 黒伏せ; seer targets rival's whites; wolves avoid repeated grey bites; wolf fake-hunter claim.
- Learned per-rule scales from logistic regression, per player count; equilibrium search over wolf knobs (`TUNE_BY_N`).
- Naturalness audit with regression thresholds; speech template variety doubled; new statement kinds (defend_self, disagree, asked answers).
- 15-player roster gains two masons (fox balance).
- UI: event illustrations, auto-scroll, role-coloured bubbles, action-panel pulse, deep links by seed, SEO/OGP for the public site.

## 0.1.0 — 2026-10

- First public build of ひとり人狼 at kayaigoing.org/hitori-jinro/.
