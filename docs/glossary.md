# Glossary

Japanese Werewolf (人狼) has a rich jargon, and the code, comments, think logs and game text use it. This table maps the terms you will meet in the source to English.

| Japanese | Romaji | English / meaning in this engine |
|---|---|---|
| 人狼 | jinrō | werewolf; also the game itself |
| 村人 / 村 | murabito / mura | villager / the village (camp) |
| 占い師 | uranaishi | seer (fortune-teller). Divines one player per night |
| 霊能者 / 霊能 | reinōsha / reinō | medium. Learns the colour of the executed player |
| 狩人 | kariudo | hunter (bodyguard). Guards one player per night |
| 共有者 / 共有 | kyōyūsha | masons (two players who know each other) |
| 狂人 | kyōjin | madman: a human on the wolves' side who does not know the wolves |
| 妖狐 / 狐 | yōko / kitsune | fox: third party; immune to bites, dies when divined, wins alone if alive at the end |
| 陣営 | jin'ei | camp (village / wolf / fox) |
| 白 / 黒 | shiro / kuro | white / black: a seer or medium result meaning human / werewolf. "出す" (to give) a white or black |
| 灰 / グレー | hai / gurē | grey: a player with no claim and no result |
| 確定白 | kakutei-shiro | confirmed white (e.g. a mason) |
| CO (カミングアウト) | — | claim: publicly declaring one's role. 占いCO = seer claim |
| 対抗 | taikō | rival claimant: a second player claiming the same role |
| 騙り / 偽CO | katari / nise-CO | fake claim |
| 真 / 偽 | shin / nise | real / fake (claimant) |
| 3-1, 2-1 | — | claim pattern: 3 seer claims and 1 medium claim, etc. |
| 囲い | kakoi | fencing: a fake seer giving a white to a fellow wolf |
| 身内切り | miuchi-giri | cutting a mate: a wolf voting for a doomed fellow wolf to look innocent |
| 対抗黒 | taikō-guro | counter-black: a fake seer giving a black to the real seer |
| 黒伏せ | kuro-fuse | the medium hiding its claim while a black is already out |
| 潜伏 | senpuku | staying hidden (not claiming) |
| 吊り / 吊る | tsuri / tsuru | execution / to execute (lynch). 吊り逃れ = dodging execution (by claiming) |
| 縄 | nawa | "ropes": the number of executions the village can afford before losing |
| 噛み / 噛む / 襲撃 | kami / kamu / shūgeki | bite / to bite / attack (the wolves' night kill). 霊能噛み = biting the medium |
| 灰噛み | hai-gami | grey bite: biting a player with no claim or result |
| 護衛 / 護衛成功 / GJ | goei / goei-seikō | guard / successful guard ("Good Job") |
| 平和な朝 | heiwa na asa | peaceful morning: nobody died in the night |
| 呪殺 | jusatsu | curse-kill: the fox dies because the seer divined it |
| 破綻 | hatan | a claim shown to be impossible (e.g. the claimant's black was executed and the medium says white) |
| ローラー (占いローラー) | rōrā | roller: executing all claimants of a role in turn |
| 決め手 | kimete | decisive evidence (a bite, a medium result) |
| 判定チェック | hantei-chekku | checking a claimant's result against a known fact (used for hunter guard reports) |
| 視点 | shiten | viewpoint: reasoning from the standpoint "if my claim is true, then…" |
| 疑惑度 | giwakudo | suspicion (the 0–100 number in `Belief`) |
| 信憑性 | shinpyōsei | credibility (of a seer claim, 0–1) |
| 台帳 | daichō | ledger (list of suspicion changes with reasons) |
| 投票宣言 | tōhyō-sengen | declaring whom you will vote for |
| 様子見 | yōsumi | "wait and see" (the no-op statement) |
| 後出し | atodashi | a late claim (after seeing the others) |
| 定員 | teiin | seat count: how many of a role the preset contains |
| 人外 | jingai | non-human (wolf, madman, fox) |
| 村勝ち / 狼勝ち | mura-gachi / ōkami-gachi | village win / wolf win |
| 観戦 | kansen | spectate (AI-only game in the browser UI) |
| 参加 | sanka | play (take a seat in the browser UI) |
| seed / 再現コード | — | seed / replay code (seed + the human's inputs) |

### Rule flag prefixes

`v_` village-side rule, `w_` wolf-side rule, `m_` madman or medium, `s_` seer, `a_` applies to all. Listed by `node dist/sim.js --flags`.
