# Role strategies

Each role is a `RoleStrategy` object in [`src/agents/roles/`](../src/agents/roles/) and is registered in [`roles/index.ts`](../src/agents/roles/index.ts). A strategy implements any subset of these hooks (interface in [`src/agents/types.ts`](../src/agents/types.ts)):

| Hook | Called | Purpose |
|---|---|---|
| `init(mem, {rng, beh})` | once, first observation | Decide standing plans (e.g. "will I fake-claim?") |
| `talkExtras(ctx)` | every speech turn | Add role-specific speech candidates (claims, result reports, proposals) |
| `bonus(ctx, cand)` | every speech turn | Adjust the rule score of a generic candidate |
| `targetOk(ctx, t, kind)` | accuse / defend / vote / agree | Veto a target (wolves never vote a mate unless cutting) |
| `voteRule(ctx, t)` | vote | Replace the default vote score for `t` |
| `nightCands(ctx, kind)` | night | Candidates for divine / guard / attack |
| `wolfPlan(ctx)` | night 0, wolves | Fake-claim / fencing / mate-cutting plan |
| `internal(ctx, chosen)` | logging | Lines for the "internal" part of the think log |
| `onSpoke(ctx, cand)` | after speaking | Update memory (claimed, reported, ...) |

The roles below are listed with the real-world convention (in brackets the Japanese term) each behaviour comes from. The text speaks of "whites" and "blacks": a seer's result that a player is human (白) or werewolf (黒).

## Village side

### Villager — [`villager.ts`](../src/agents/roles/villager.ts)
No hooks. Everything a villager does — accusing, defending, agreeing, asking, declaring a vote, pointing out a waver, proposing a plan, voting — is the generic behaviour in [`candidates.ts`](../src/agents/candidates.ts) driven by the belief model. Every other role inherits this and adds to it.

### Seer — [`seer.ts`](../src/agents/roles/seer.ts)
- **Claims** on day 1 with probability `seerCoProb` (0.95), and always if a rival claim appears (counter-claim, 対抗CO). Reports every unreported result, oldest first (`must` candidates — not reporting would be unnatural).
- **Divination target** (night): greys first — players with no role claim and a mid-range suspicion carry the most information. Claimed mediums/hunters/masons are divined last (their result changes little), rival seer claimants last of all (nobody will believe either result). With `s_divine_rival_white`, the rival's whites get priority: a black there exposes fencing. In a fox game, trusted-looking quiet players get a fox-hunting bonus (`foxHuntW`).
- Uses its own results with near certainty (`certainBlack` / `certainWhite`) and treats every rival claimant as fake (viewpoint).

### Medium — [`medium.ts`](../src/agents/roles/medium.ts)
- Claims on day 1 with probability `mediumCoDay1Prob` (0.85) — the "1" of the 3-1 pattern — except when a black is already out: then it **hides** (黒伏せ, flag `m_black_hide`) and claims next morning together with the result, so wolves cannot bite it before it has spoken. Claims immediately if the black's target claims a role, or if a rival medium appears.
- Reports results oldest first; a result that contradicts a seer claim marks that claim broken for everyone.

### Hunter — [`hunter.ts`](../src/agents/roles/hunter.ts)
- Stays hidden. Claims only to escape execution (two or more accusers, or ≥30 % of the heat on itself) or to counter a rival hunter claim.
- **Guard priority**: credible seer claimant > medium > mason > most trusted player; a claimant that looks fake is not guarded. Honors `noConsecutiveGuard`.
- After a claim, reports every successful guard the next peaceful morning (`gjReportedDay`), so the village can run the "判定チェック": a report that matches a peaceful morning raises trust, a report on a morning with a death marks the claimant fake.

### Mason — [`mason.ts`](../src/agents/roles/mason.ts)
Two seats that know each other. Claim together with probability `masonCoProb` (0.85) to become confirmed whites, never suspect or vote each other, treat any third mason claim as fake.

## Werewolf side

### Werewolf — [`werewolf.ts`](../src/agents/roles/werewolf.ts)
The largest strategy. The core discipline: **two minds**. Public speech is driven by a belief built from public information only (so a wolf never "accidentally" knows too much); private knowledge is used only for biting, fake claims and mate handling.

- **Night 0 plan** (`wolfPlan`): with probability `wolfFakeProb` one wolf will claim seer; fencing (囲い: the fake seer gives a mate a white) with probability `kakoiP`; mate-cutting (身内切り) on by default.
- **Fake claim** (shared with the madman in [`fake.ts`](../src/agents/roles/fake.ts)): fabricated results follow the same targeting conventions as a real seer (no results on claimed roles — a black on a mason is instantly exposed). Blacks only when no medium can contradict them next morning (`w_no_black_medium`), or as a deliberate **counter-black** on the real seer (`counterBlackP`). If two or more other seer claims already exist, abandon the claim and stay hidden (`w_co_limit`). Reports results like a real seer would.
- **Truth check** (`w_truth_check`): the wolves know who the wolves are, so any claimant whose results are all consistent with the truth is probably the real seer, and one with a wrong result is certainly the madman — whom they must neither bite nor accuse (`w_avoid_madman`), and whose blacks they must not bite (`w_avoid_blacked`, biting your own fake black exposes the lie).
- **Bite priority**: credible seer > claimed hunter (bitten the same night, `w_bite_hunter`) > medium while a fake claim is alive (`w_medium_bite` — the medium is the one who can expose it) > masons > the most trusted villager. Holds off biting the real seer while its own fake claim is the only alternative (`w_seer_hold`: "the surviving claimant is fake" would be too obvious). Avoids pure greys twice in a row (`w_grey_once`). Reacts to a successful guard: avoid that target if consecutive guards are allowed, otherwise target them (they cannot be guarded again tonight).
- **Fox / guard inference** from its own bite history: a target that survived two bites is probably the fox.
- **Daytime**: ride the majority; defend a mate only mildly and only early; cut a mate who is going down anyway (`w_mates_cut`, threshold `matesCutHeat`); push the real seer only when a rival claim exists and others have started to doubt it (`w_push_gate`); may claim hunter to dodge execution (`w_hunter_fake`) at the cost of being "the hunter nobody bit" tomorrow.

### Madman — [`madman.ts`](../src/agents/roles/madman.ts)
Does not know the wolves. Fake-claims seer with probability `madFakeProb`, otherwise medium with `madFakeMediumProb` (`m_fake_medium`); the fabricated results come from `fake.ts` and are driven by its public-information suspicion, which is exactly why the wolves can spot it. Accuses the most credible other seer claimant.

## Third party

### Fox — [`fox.ts`](../src/agents/roles/fox.ts)
Survives bites, dies when divined. Never claims, never leads an accusation, votes with the majority, nudges suspicion toward seer claimants (a living seer is the only thing that can kill it). It knows a "peaceful morning" may have been its own doing.

## Adding a role

1. Add the id to `RoleId` and a `RoleDef` entry in [`src/game/roles.ts`](../src/game/roles.ts) (camp, counts-as-wolf, seer colour, night action, display strings).
2. Add the strategy file and register it in `roles/index.ts`.
3. If the role has private information, add a field to `PlayerObservation.priv` and populate it in `buildObservation()` — this is the only place allowed to read a true role, and only the observer's own.
4. If other players should reason about the new claim, extend `Belief` (claim bookkeeping) and `viewpoint.ts`.
5. Add it to a preset in [`src/game/config.ts`](../src/game/config.ts), run `npm test` (the leak test covers every preset) and `node dist/sim.js --compare` the balance.
