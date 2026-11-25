# Reasoning: how an agent decides who is a werewolf

All reasoning lives in [`src/agents/belief.ts`](../src/agents/belief.ts). This page explains the model, the rules, and how to read the numbers. Nothing here uses the true roles; everything is computed from the observation (public events + the agent's own private results).

## 1. The model

For every other player `j` the agent keeps:

| Field | Meaning |
|---|---|
| `susp[j]` | Suspicion, clamped to 0–100. Starts near 50 with a small personality-dependent first impression. |
| `ledger[j]` | List of `{ label, delta, day }` — every change and why. This is what the UI shows as "AI思考" and what the batch runner scores for accuracy. |
| `seerTrust(j)` | Credibility 0–1 of `j`'s seer claim (only meaningful for claimants). Rises when `j`'s results match confirmed facts (medium results, deaths), falls when they contradict, is 0 for a claim the agent itself knows is false. |
| claim books | Who claimed seer / medium / hunter / mason, when, and whether the claim is broken. |
| `wolvesLeftMax` | Upper bound on living wolves from the preset minus confirmed black executions. Drives "end-game" behaviour and fox alertness. |

Suspicion is **additive**: a rule produces a delta, the delta is multiplied by a learned scale (section 4), and added. There is no normalisation across players and no joint probability over role assignments. The agent votes for the highest effective suspicion after role-claim penalties (`rolePenalty`) and fox pressure.

## 2. The rules

Rules fire while `Belief.update()` replays new public events. Each has a weight in the `W` table of `belief.ts`; the comments there state what each weight means and, where it was measured, why it has its value. The most important ones:

| Rule (W key) | Fires when | Effect |
|---|---|---|
| `seerBlack` / `seerWhite` | A seer claimant reports black / white on `j` | + / − scaled by that claimant's credibility (`whitePow` makes unproven whites count less — a defence against "fencing" a wolf with a fake white) |
| `certainBlack` / `certainWhite` | The agent is a real seer and divined `j` itself | ±, near-certain |
| `fakeSeer` | `j` claimed seer but the agent has reason to believe the claim is fake (contradiction with a medium result, with the agent's own result, over the seat count, ...) | large + |
| `brokenSeer` | `j`'s black was executed and the medium says white | large + |
| `lateChange` | `j` declared a vote and then voted elsewhere | + (the comment in `W` records an early measurement of 94 % hits; the current per-rule table in [benchmark.md](benchmark.md) shows it is much weaker now that wolves cut mates deliberately — a good example of why numbers must be re-measured) |
| `lynchBlackVoter` / `lynchWhiteVoter` | `j` voted for someone later confirmed black / white | − / + |
| `defendBlack` | `j` defended someone later confirmed black | + |
| `accuseTrusted` / `accuseConfirmedWhite` | `j` accused someone the agent trusts / a confirmed white | + |
| `hunterUnbitten` | `j` claimed hunter and nobody died the next morning(s) — wolves would have bitten a real hunter | + per night |
| `hunterGj` / `hunterGjBroken` | `j` reported a successful guard and the morning was / was not peaceful | − / large + |
| `mediumTrust`, `hunterTrust`, `masonTrust` | Role claim within the preset's seat count | − (claims are rarely fake, so mild trust) |
| `silent`, `silentPoint`, `biteLogicWhite`, `coTiming` | Conversation-level cues | small; several were measured as useless for win rate and are kept at 0 only to make speech varied |

The full list, with the exact numbers, is the `W` object in the source — it is the single source of truth and the comments are kept up to date when a weight is re-tuned.

### Credibility of seer claims

Rather than treating "seer" as true or false, each claim has a credibility `q ∈ [0,1]`. Deltas from that claimant's results are scaled by `q` (blacks) or `q^whitePow` (whites). `q` grows by `1 + matchGain·q` when a result is confirmed and collapses to near zero on contradiction. Suspicion *of the claimant* is `fakeSeer · (1−q)^compPow`. This is why the agents don't "roller" (execute all claimants in turn) by default: the minimax search in the design history found that waiting for evidence (`undecidedComp = 0`) gives the village the best worst case.

### Viewpoint consistency

A player who publicly claimed a role — honestly or not — must act as if the claim were true, otherwise humans immediately read the inconsistency. [`src/agents/viewpoint.ts`](../src/agents/viewpoint.ts) post-processes candidates: no accusing or voting one's own whites, pushing one's own blacks, treating rival claimants as fake, not citing a rival's black as a reason, never proposing a roller that includes oneself. A fake seer therefore defends its fake whites with the same conviction as a real one.

## 3. Reading a think log

```
■ ⛩️京都 [占い師/仕切り型] 3日目 発言
  🌺沖縄 疑惑度 78
      + 占い黒(大阪, 信憑性0.8) +46.4
      + 投票先を変えた +10.0
  🗼東京 疑惑度 41
      ...
  候補:
      沖縄を疑う  81.2 (ルール 72 / 性格 +4.2 / 乱数 +5.0)
      様子見      40.1 (...)
  最終判断: 沖縄を疑う → 「沖縄、黒が出てる。今日はそこやろ」
```

Every entry lists the suspicion vector with its ledger items, the top candidates with the three score components (rule / personality / noise), and the chosen action. Werewolves additionally record an 【内部】 (internal) block — what they know privately — separately from what they say. `node dist/sim.js --replay <seed> --think` prints the whole game; the browser UI shows the same data per player after the game ("AI思考を見る"). Labels are Japanese; the [glossary](glossary.md) translates the recurring ones.

## 4. Learned per-rule scales

The rule *shapes* are hand-written; their *magnitudes* were calibrated offline:

1. `node dist/sim.js --n 13 --games 3000 --dump feat.jsonl` writes, for every village-side agent before every vote, the summed ledger delta per rule key and whether the target was actually a wolf.
2. [`scripts/learn.py`](../scripts/learn.py) fits a logistic regression (scikit-learn) per player count and reports AUC.
3. The coefficients, blended with 1.0 (40 % at 7 players, 80 % at 13 — a full replacement over-fitted and lowered the village win rate), are written to [`src/agents/rule-scale.gen.ts`](../src/agents/rule-scale.gen.ts) and applied in `Belief.apply()` when the flag `v_learned_scale` is on.

Rule keys are normalised labels (names → ○, digits → #) produced by [`src/agents/rulekey.ts`](../src/agents/rulekey.ts), so the same rule gets the same key whoever it fired on.

Switch any rule off with `--off key` (list: `node dist/sim.js --flags`) to measure its contribution; `--rules` prints the per-rule hit rate (share of firings that pointed at a wolf).

## 5. Werewolf-side reasoning

Wolves run the same `Belief` on public information to decide what to *say* (so they never leak private knowledge through their speech), and a separate private evaluation to decide what to *do*: whom to bite (`seerAttackW`, `mediumBiteW`, `hunterAttackW`, `trustAttackW`, grey-bite avoidance), whether to fake-claim, whether to fence a mate, when to cut a doomed mate. Those knobs are the `TUNE_DEFAULTS` in [`src/agents/flags.ts`](../src/agents/flags.ts), with per-player-count overrides found by the equilibrium search ([strategy.md](strategy.md)).

## 6. Measuring reasoning quality

`node dist/sim.js --n 13 --games 2000 --rules` reports, besides win rates:

- **Vote accuracy** — share of first-round village votes that hit a wolf.
- **Rank AUC** — for every (wolf, villager) pair before a vote, how often the villager ranked the wolf higher. 0.5 is chance.
- **Trajectory** — mean suspicion on wolves vs villagers by day.
- **Per-rule hit rate** — which rules point the right way, and how often they fire.

See [benchmark.md](benchmark.md) for current numbers.
