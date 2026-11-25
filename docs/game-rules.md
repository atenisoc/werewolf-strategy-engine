# Game rules implemented by the engine

The engine plays the Japanese standard variant of Werewolf (人狼). This page is the normative description of what [`src/game/engine.ts`](../src/game/engine.ts) does; the comments in that file are the source of truth if the two ever disagree.

## Roles

| Role (日本語) | Camp | Counts as wolf | Seer sees | Night action |
|---|---|---|---|---|
| Villager (村人) | village | no | white | — |
| Seer (占い師) | village | no | white | divine one player → white / black |
| Medium (霊能者) | village | no | white | — (learns the colour of today's executed player) |
| Hunter (狩人, bodyguard) | village | no | white | guard one player |
| Mason (共有者) | village | no | white | — (the two masons know each other) |
| Werewolf (人狼) | wolf | yes | black | attack one player (joint decision) |
| Madman (狂人) | wolf | no | white | — (does not know who the wolves are) |
| Fox (妖狐) | third party | no | white | — (immune to attack, dies when divined) |

Definition in [`src/game/roles.ts`](../src/game/roles.ts). "Counts as wolf" is what the win condition counts; the madman is human for counting and for the seer.

## Presets

| Players | Roster | Day-1 vote | Consecutive guard |
|---:|---|---|---|
| 5 | wolf 1 · seer 1 · villager 3 | no | not allowed |
| 7 | wolf 2 · seer 1 · hunter 1 · villager 3 | no | not allowed |
| 9 | wolf 2 · madman 1 · seer 1 · medium 1 · hunter 1 · villager 3 | yes | not allowed |
| 13 | wolf 3 · madman 1 · seer 1 · medium 1 · hunter 1 · villager 6 | yes | **allowed** |
| 15 | wolf 3 · madman 1 · fox 1 · seer 1 · medium 1 · hunter 1 · mason 2 · villager 5 | yes | not allowed |

[`src/game/config.ts`](../src/game/config.ts). The 13-player consecutive-guard exception comes from the balance analysis in [strategy.md](strategy.md). The 15-player masons were added because without them the village won 25 % and the fox up to 44 %.

## Sequence

1. **Night 0.** Wolves hold a planning meeting (who fake-claims seer, whether to fence, whether to cut). The seer may divine on night 0 (`firstNightDivine`, default on). No attack.
2. **Day d, discussion.** `rounds` (default 2) rounds; in each round every living player speaks once, in seat order. A statement is structured (accuse / defend / claim / report / …); humans pick from the same set.
3. **Day d, vote** (skipped on day 1 for 5 and 7 players). Everyone votes for one other living player. If the top vote is tied, one **runoff** among the tied players is held; if still tied, the engine picks one of them at random (from the game's own RNG stream, so still reproducible). The executed player's colour is revealed privately to living mediums.
4. **Win check.**
5. **Night d.** Wolves each propose a target; the majority wins, ties broken randomly (a human wolf decides directly). The seer divines; the hunter guards (not the same player as last night unless the preset allows).
6. **Morning d+1.** If the attack target was guarded, or is the fox, nobody dies from the attack ("peaceful morning", 平和な朝). A fox that was divined tonight dies ("cursed", 呪殺). Deaths are announced without cause and in seat order.
7. **Win check**, then back to 2. `maxDays` (default 20) ends an unfinished game as a draw; in practice this never triggers (0 draws in the benchmark).

## Win conditions (`checkWinner`)

- Village wins when no werewolf is alive.
- Wolves win when the number of living werewolves is ≥ the number of other living players.
- If either happens while the fox is alive, **the fox alone wins**.
- Masons and the madman win with their camp; a dead player wins with their camp.

## Information

Public: phase changes, every statement (structured and rendered), every vote, executions with vote counts, night deaths (no cause), peaceful mornings, the end result.

Private: wolves know each other and share the planning channel; masons know each other; the seer knows its results; the medium knows executed colours; the hunter knows whom it guarded and whether it succeeded. Nobody is told whether a peaceful morning was a guard or a fox, and the seer is not told that a death was a curse.

## Human player

One seat may be human ([`src/game/session.ts`](../src/game/session.ts)). The human sees exactly the observation an AI in that seat would see, chooses statements from the same structured set, and may ask the built-in advisor (an AI running on the human's observation, no randomness) for hints. A human game is reproducible from its seed plus the human's inputs (replay code).
