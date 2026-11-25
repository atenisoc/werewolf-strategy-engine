# Benchmark

Reproducible self-play results for the current version. Re-generate with:

```bash
npm run build
node scripts/benchmark.mjs --games 2000 --seed 7001 --out bench   # table below
node dist/sim.js --n 13 --games 2000 --seed 7001 --rules          # per-rule accuracy
```

All numbers below are AI vs AI with the default settings (`makeConfig(n)`: rule/personality/noise = 0.75/0.15/0.10, dialect on, learned rule scales on). Seeds are consecutive, so any run on the same version reproduces the same games.

## Win rates by player count (2000 games each, seeds 7001–9000)

| Players | Roles | Village | Werewolf | Fox | Avg days | Vote acc. | Rank AUC | Anomalies | Time (2000 games) |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | werewolf×1 seer×1 villager×3 | 55.5% | 44.5% | - | 2.44 | 62.9% | 77.2% | 0 | 3.7s |
| 7 | werewolf×2 seer×1 hunter×1 villager×3 | 53.1% | 46.9% | - | 3.43 | 73.7% | 78.0% | 0 | 7.6s |
| 9 | werewolf×2 madman×1 seer×1 medium×1 hunter×1 villager×3 | 54.5% | 45.5% | - | 3.61 | 46.0% | 67.2% | 0 | 9.6s |
| 13 | werewolf×3 madman×1 seer×1 medium×1 hunter×1 villager×6 | 46.9% | 53.0% | - | 5.37 | 45.4% | 67.0% | 0 | 21.8s |
| 15 | werewolf×3 madman×1 fox×1 seer×1 medium×1 hunter×1 mason×2 villager×5 | 40.4% | 41.9% | 17.8% | 6.47 | 35.3% | 69.8% | 0 | 44.3s |

- **Vote acc.** — share of village-side first-round votes cast on a werewolf.
- **Rank AUC** — before each vote, for every (wolf, villager) pair seen by a village-side agent, how often the wolf had the higher suspicion. 0.5 = chance.
- **Anomalies** — invariant violations, exceptions or non-terminating games. Information-leak audits (`--audit`) also report 0 on every size.

Role survival at game end:

| Players | villager | seer | medium | hunter | mason | werewolf | madman | fox |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 69.7% | 2.0% | - | - | - | 44.5% | - | - |
| 7 | 60.1% | 34.0% | - | 24.4% | - | 33.9% | - | - |
| 9 | 56.4% | 20.8% | 38.1% | 29.9% | - | 32.5% | 34.2% | - |
| 13 | 39.1% | 9.1% | 47.3% | 17.3% | - | 34.0% | 19.7% | - |
| 15 | 42.1% | 13.5% | 3.1% | 23.6% | 15.3% | 25.0% | 29.8% | 17.8% |

(The 5-player seer "survives" 2 % because the game usually ends before night 2; the 15-player medium is the wolves' first target while a fake seer is alive.)

## Speed

| Run | Wall time |
|---|---|
| 13 players × 2 000 games | 21.8 s (≈ 11 ms / game, ≈ 2 ms / game-day) |
| 13 players × 10 000 games (seeds 1–10000) | 100 s — village 47.9 %, wolves 52.1 %, 0 anomalies |

Environment: Node v22.23.5, Linux x64, Intel Xeon @ 2.10 GHz (2 vCPU, single-threaded run). Memory is negligible (no state is kept between games).

## Per-rule accuracy (13 players, 2000 games)

For every suspicion change applied by a village-side agent: did it point the right way (+ on a wolf, − on a villager)? "Wolf share" is how often the rule fired on a wolf at all; a rule whose hit rate equals its wolf share carries no information.

| Firings | Hit rate | Wolf share | Mean Δ on wolf | Mean Δ on villager | Rule (label, names masked) |
|---:|---:|---:|---:|---:|---|
| 86822 | 44% | 18% | 2.4 | 1.1 | ○の信憑性が変化→○への判定 (claimant credibility changed → re-weighted result) |
| 74776 | 33% | 33% | 2.9 | 2.9 | 白の○に投票していた (voted for a confirmed white) |
| 70149 | 79% | 15% | -6.3 | -5.6 | 占い師○の判定(白) (seer reports white) |
| 45521 | 87% | 13% | -8.5 | -8.1 | 黒の○に投票していた (voted for a confirmed black) |
| 15209 | 100% | 0% | 0.0 | -22.6 | 霊能CO(定員内) (medium claim within seat count) |
| 12332 | 58% | 55% | 9.5 | 7.1 | 占い師○の判定(黒) (seer reports black) |
| 8164 | 59% | 61% | 20.8 | 3.6 | 占い師CO#人中の一人 (one of N seer claimants) |
| 3625 | 57% | 57% | 17.7 | 5.4 | 占い師CO(信憑性#%) (seer claim, credibility) |
| 3063 | 100% | 0% | 0.0 | -19.1 | 護衛成功の報告が平和な朝と一致 (guard report matches peaceful morning) |
| 1074 | 69% | 69% | 24.9 | 10.9 | ○への判定が○と食い違う (two claimants disagree) |
| 966 | 94% | 94% | 15.7 | 16.9 | 狩人COなのに#晩噛まれていない (claimed hunter not bitten) |
| 668 | 79% | 79% | 50.7 | 18.2 | 後出しのCO (late claim) |
| 549 | 100% | 100% | 73.2 | 0.0 | 自分の占いで黒 (own divination: black) |
| 248 | 89% | 89% | 42.6 | 12.0 | ○の判定が霊能結果と矛盾 (result contradicts medium) |
| 169 | 78% | 38% | 32.0 | -0.1 | 襲撃された○に白を出していた (gave white to someone later bitten) |

Full table: run the command above. Note the *mean Δ* columns: the learned scales already shrink rules whose hit rate is near their wolf share (e.g. "voted for a confirmed white": 33 % / 33 %), which is why they still fire but barely move anything.

## Suspicion trajectory (9 players)

Mean suspicion held by village-side agents before each vote:

| Day | on wolves | on villagers | gap |
|---:|---:|---:|---:|
| 1 | 27.8 | 22.6 | 5.2 |
| 2 | 29.8 | 18.5 | 11.3 |
| 3 | 31.4 | 19.2 | 12.2 |
| 4 | 29.8 | 20.5 | 9.4 |

## Comparing a change

`node dist/sim.js --compare <variant> --n 13 --games 2000` runs the same seeds with the baseline and with your variant and prints the difference with a 95 % interval (normal approximation). With 2000 games the interval on the difference is about ±3 points, so a change needs to move the rate by more than that to be called real. Example with the shipped sample variant at 9 players (300 games): −4.3 pt ± 8.0 — i.e. not significant at that sample size.

## What these numbers do and do not say

- They measure the AI against itself with the default knobs. A village that is strong against *these* wolves may be weak against a differently tuned wolf; the equilibrium search in [strategy.md](strategy.md) exists for that reason. Treat "village 47 %" as "balanced under self-play", not as an absolute strength.
- Vote accuracy includes day-1 votes in 9+ player games, where almost no information exists yet, so it understates late-game accuracy.
- There is no human baseline. We have a small classifier that scores human game logs with the same ledger ([`scripts/classify_log.mjs`](../scripts/classify_log.mjs)), but no published comparison yet — see [roadmap.md](roadmap.md).
- Earlier numbers in the Japanese design history were measured on earlier versions and are not comparable with this table.
