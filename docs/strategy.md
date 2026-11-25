# Strategy design: why the AI plays the way it does

The rules in this engine were not written once and left alone. Each one was proposed from Werewolf theory (Japanese 人狼 conventions, plus a web survey summarised in the design history), then **measured** by thousands of self-play games, and kept, re-weighted or switched off according to the result. This page explains the method and the main conclusions, so that a contributor knows which knobs exist and how a change should be evaluated.

This document summarizes the strategy design and its evaluation.

## 1. Decision = rule + personality + noise

Every candidate action gets `0.75·rule + 0.15·personality + 0.10·noise` ([`src/agents/decision.ts`](../src/agents/decision.ts)). Night actions (bite, guard) triple the noise because they are a guessing game and a guard that always succeeds reads as cheating. The split is configurable (`--weights`), and a test pins it.

Seven personality presets ([`src/agents/personality.ts`](../src/agents/personality.ts): cautious, aggressive, follower, analyst, moody, quiet, leader) shift the first impression and the appeal of accusing vs waiting. The batch report prints per-personality win rates and warns if any preset deviates by more than ~10 points from its camp average, so personalities stay flavour, not strength.

## 2. Accept a rule only if it helps the camp that uses it

Village-side rules are judged by village win rate with everything else fixed; wolf-side rules by wolf win rate. `node dist/sim.js --off <flag>` disables one rule (list: `--flags`). Rules that measured neutral were kept at weight 0 **only if** they make the conversation richer (e.g. pointing out that someone wavered). Examples of rules that were removed or zeroed after measurement:

- reading a low-credibility seer's results in reverse (`fakeReverse`): −5 points for the village — it also inverts a madman's random results;
- suspecting all seer claimants each night nobody is bitten (`seerUnbitten`): −7 points — it gets the real seer executed;
- pulling votes toward the majority: lowered the village win rate — it amplifies a wolf's push.

## 3. Minimax over the opponent's strategy

A rule that looks good against the current opponent can be bad against an opponent who adapts. The 13-player analysis (design history ch. 8) built a table of *village policy × wolf policy*:

- village policy: how to treat multiple seer claimants (`undecidedComp`: roller from day 1 / prefer grey / wait for evidence);
- wolf policy: madman fake-claims or not × wolf fake-claims never / sometimes / usually;
- rule: consecutive guard allowed or not.

Outcome: the village's best worst case is **wait for evidence** (`undecidedComp = 0`). Whether wolves should fake-claim depends on the guard rule: without consecutive guards the real seer dies by day 2 anyway and a fake claim just hands the village a free execution (wolves 61 % vs 51 %); with consecutive guards the hunter can keep the real seer alive, fake claims become worthwhile, and the standard 3-1 claim pattern of real-world 13-player games emerges from the simulation (wolves 46 %). The engine therefore allows consecutive guards at 13 players only.

## 4. Equilibrium search per player count (ch. 23)

[`scripts/equilibrium.sh`](../scripts/equilibrium.sh) and [`scripts/tune.mjs`](../scripts/tune.mjs) iterate: fix the village, let the wolves pick the best of a grid of `TUNE_DEFAULTS` values; fix the wolves, re-fit the village's rule scales by logistic regression ([reasoning.md](reasoning.md) §4); repeat. The per-player-count results are `TUNE_BY_N` in [`src/agents/flags.ts`](../src/agents/flags.ts). The single most important wolf knob turned out to be **fencing** (`kakoiP`: the fake seer giving a white to a mate): it moves ~12 points toward the wolves at 13 players, so the wolves' equilibrium is to fence only a quarter of the time (fencing is also what makes a fake claim detectable later).

At 15 players with a fox, the first roster (no masons) gave the village 25 % and the fox up to 44 %. Adding two masons and tuning the fox-hunting weights brought it to village ≈40 / wolves ≈42 / fox ≈18 — not a 50/50 game, and documented as such in [benchmark.md](benchmark.md).

## 5. Theory that made it in

From the convention survey (ch. 21) and the review (ch. 22):

| Convention | Implementation |
|---|---|
| Medium hides on day 1 if a black is already out ("黒伏せ"), claims with the result next morning | `m_black_hide` in [`roles/medium.ts`](../src/agents/roles/medium.ts) |
| Seer divines the rival claimant's whites first (a black there exposes fencing) | `s_divine_rival_white` in [`roles/seer.ts`](../src/agents/roles/seer.ts) |
| Wolves don't bite pure greys twice in a row (grey bites prove the victim white and corner the wolves) | `w_grey_once` in [`roles/werewolf.ts`](../src/agents/roles/werewolf.ts) |
| A hunter who claims is bitten that night; a claimed hunter who survives nights is suspicious | `w_bite_hunter`, `v_hunter_unbitten` |
| A hunter's guard report must match the morning ("判定チェック") | `hunterGj` / `hunterGjBroken` |
| If the real seer is bitten, remaining claimants are (probably) fake; read their whites as slightly black | `v_fake_confirmed_attack` |
| A claimant never contradicts their own results | [`viewpoint.ts`](../src/agents/viewpoint.ts) |

## 6. Naturalness is measured too

Win rate is not the only metric. [`src/simulation/naturalness.ts`](../src/simulation/naturalness.ts) audits a batch for things humans notice: accusing someone you defended the same day, repeating a phrase, claiming "late" when you were not last, ignoring a direct question, a claimant defending a rival. A regression test keeps these under thresholds. `npm run audit -- 300 13` prints the counts.

## 7. How to evaluate a change

1. Build: `npm run build`.
2. Same seeds, before/after: `node dist/sim.js --compare <your-variant> --n 13 --games 2000` (see [extension-guide.md](extension-guide.md)). Look at the confidence interval, not just the sign.
3. Check both camps: a village-side rule that also raises the wolf win rate in some other size is suspicious.
4. Check all sizes you touched (5/7/9/13/15 have different equilibria).
5. `npm test` — the naturalness audit and the information-leak test must still pass.
6. If you changed a weight, update the comment next to it with the measured effect. The `W` table *is* the documentation.
