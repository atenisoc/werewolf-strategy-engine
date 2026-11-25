import type { Behavior } from '../game/types';

// 推理ルールのON/OFF(検証用)。off に入れたルールは無効になり、「そのルールがどの陣営の勝率に効くか」を測れる。
//   node dist/sim.js --n 13 --games 1000 --off v_seer_penalty,w_truth_check
export const RULE_FLAGS: Record<string, string> = {
  // 村側
  v_seer_penalty: '本物らしい占い師を吊り候補から外す(信憑性に比例して減点)',
  v_reverse: '信憑性の低い占い師の判定を逆に読む(偽の黒先は白寄り・身内白は黒寄り)',
  v_mason_white: '定員内の共有者COを確定白として扱い、確定白を疑う人を疑う',
  v_attacked_real: '襲撃された占い師COを本物寄りに(×1.8)',
  v_fake_confirmed: '処刑されて黒だった占い師COを偽物確定に',
  v_sticky_intent: '宣言した相手にそのまま投票する(+40)',
  // 人狼側
  w_truth_check: '占い師COの判定を真実と照合し、本物/狂人を見分ける',
  w_avoid_madman: '狂人(判定が外れたCO)を襲撃しない・疑わない',
  w_avoid_blacked: '自分たちの偽占いが黒を出した相手を襲撃しない',
  w_seer_hold: '偽COが生きていて他に偽COがいないとき、本物の襲撃を急がない',
  w_medium_bite: '偽COが生きている間は霊能者を最優先で襲撃',
  w_no_black_medium: '霊能者が生きている間は偽の黒を出さない',
  w_co_limit: 'すでに占い師COが多いときは騙りをやめて潜伏',
  w_mates_cut: '吊られそうな仲間に自分も投票(身内切り)・かばわない',
  w_push_gate: '対抗がいて他も疑い始めたときだけ本物の占い師を吊りに行く',
  w_counter_black: '偽占いが本物の占い師に黒を出す(対抗黒)ことがある',
  w_avoid_guarded: '護衛成功(平和な朝)が出た相手を、連続護衛ありなら避け、なしなら今夜は守れないので狙う',
  w_bite_hunter: '狩人COが出たら、その夜は必ず狩人を噛む(狩人は自分を守れない。護衛を潰せば以後の襲撃が通る)',
  w_hunter_fake: '人狼が吊られそうなとき、狩人を騙って吊り逃れすることがある(翌日以降「噛まれない狩人CO」で疑われる)',
  v_waver: 'ブレ(昨日と今日で疑い先が変わった)を指摘された人を少し疑う',
  v_bite_logic: '噛まれた人が疑っていた人を少し疑い、かばっていた人を少し信じる(人狼は自分を疑う人を消す)',
  v_co_timing: '占い師COの速さ: 先に出たCOを少し信じ、後出しを少し疑う',
  v_seer_unbitten: '占いCOが2人以上いて誰も噛まれない朝が続くと、占いCO全員を少しずつ疑う(本物なら噛まれる。GJが出た朝は除く)',
  a_viewpoint: '視点の整合性: 役職CO(本物・騙り)は自分の白を疑わず、自分の黒を吊りに行き、対抗を偽物として扱い、対抗の判定を根拠にしない',
  v_learned_scale: '学習したルール倍率(rule-scale.gen.ts)を疑惑の増分に掛ける(ロジスティック回帰で推定)',
  m_black_hide: '黒伏せ: 初日に占いの黒が出ていたら霊能者は潜伏し、翌朝の結果と一緒にCOする(役職を噛みから守る。黒先が役職COしたら即CO)',
  s_divine_rival_white: '占い先の定石: 対抗の占い師が白を出した人を優先して占う(黒なら対抗の囲いが露呈する)',
  w_grey_once: '人狼の噛み: 完全グレー(COも白もない人)を続けて噛まない(灰噛みは白証明になり、人狼が灰に残って詰まる)',
  v_fake_confirmed_attack: '本物の占い師が噛まれたら、残った占いCOを偽物で確定し、その判定を逆に読む(囲いの白は黒寄り)',
  v_hunter_unbitten: '狩人COが噛まれずに夜を越すたびに疑う(人狼は仲間を噛まない)',
  // 狂人
  m_fake_medium: '狂人が霊能者を騙ることがある',
};

// 数値パラメータ(人狼側の襲撃・騙りの重み)。--tune key=val,key=val で上書きして勝率への影響を測る
export const TUNE_DEFAULTS: Record<string, number> = {
  // 村側: 占い師COが複数で決め手がないときのCOへの疑惑の倍率。1=初日からローラー、0.15=グレー吊り優先、0=決め手(襲撃・霊能結果)が出るまで吊らない
  // 0 が「人狼側がどの作戦を取っても村側の最悪ケースが一番マシ」(ミニマックス)だった
  undecidedComp: 0,
  seerHoldW: 0.5, // 偽COが生きていて他に偽COがいないときの、本物の占い師への襲撃重み(調整: 0.2→0.5)
  seerAttackW: 2.25, // 本物らしい占い師への襲撃重み(調整: 0.9→2.25。本物を早く噛むのが人狼側の最善)
  mediumBiteW: 78, // 偽COが生きている間の霊能者への襲撃重み(通常45)
  masonAttackW: 30, // 共有者COへの襲撃重み(確定白を減らす)
  trustAttackW: 0.38, // 村で信頼されている人(疑惑度が低い人)への襲撃重み(調整: 0.25→0.38)
  hunterAttackW: 82.5, // 狩人COへの襲撃重み(調整: 55→82.5)
  counterBlackP: 0.3, // 偽占いが本物の占い師に黒を出す確率
  fakeBlackP: 0.6, // 偽占いが(条件を満たすとき)黒を出す確率
  kakoiP: 1, // 作戦会議で「囲いあり」にする確率(調整: 0.3→1。囲いが人狼側の騙りを損から得に変える最大の要因。村側+12pt→人狼側へ)
  mateWhiteP: 1, // 囲いありのとき、偽占いの白を仲間に出す確率(調整: 0.6→1)
  foxPressureW: 70,
  foxPressureWolves: 1, // 人狼の残りがこの数以下と見られたら妖狐警戒を始める // 村側の終盤の妖狐警戒(人狼残り1以下のとき妖狐候補に加点)
  gjReportRule: 55, // 狩人が占い師の護衛成功を報告する候補の強さ(0で報告しない)
  foxHuntW: 0.6, // 占い師の狐探し: 疑惑度が低い人を占う重み(妖狐がいる村のみ)
  guardedW: 0.25, // 護衛成功が出た相手への襲撃重みの倍率(連続護衛ありのルールで効く)
  wolfHunterFakeP: 0.5,
  confirmW: 1, // 「偽物で確定」宣言の候補の強さ
  convW: 1, // 会話の取っ掛かり(COの速さ・指名・ブレ・噛み筋・沈黙・人数カウント)の候補の強さ(最終ラウンドは半分)。0で出さない
  matesCutHeat: 0.4, // 仲間への名指しがこの割合を超えたら身内切り(仲間に投票)してよい
};

// 人数別の上書き(均衡探索の結果。docs/DESIGN.md 23章)。村側の推理が人数で違う強さになるので、人狼側の最善も人数で変わる
export const TUNE_BY_N: Record<number, Record<string, number>> = {
  "5": {},
  "7": {
    "seerHoldW": 0.13,
    "fakeBlackP": 1,
    "kakoiP": 0.25,
    "mateWhiteP": 0.5,
    "wolfHunterFakeP": 0.75
  },
  "9": {
    "trustAttackW": 0.19,
    "kakoiP": 0.25,
    "mateWhiteP": 0.5,
    "wolfHunterFakeP": 0.75
  },
  "13": {
    "kakoiP": 0.25,
    "mateWhiteP": 0.5
  },
  "15": {
    "foxHuntW": 3,
    "foxPressureWolves": 2,
    "foxPressureW": 140,
    "kakoiP": 0.25,
    "mateWhiteP": 0.5,
    "seerAttackW": 0.56,
    "fakeBlackP": 0.15,
    "matesCutHeat": 0.2
  }
};

// 村側推理の重み(belief.ts の W)の人数別上書き(均衡探索の結果)
export const W_BY_N: Record<number, Record<string, number>> = {
};

export type Flags = { on(key: string): boolean; v(key: string): number };
export function makeFlags(beh: Behavior): Flags {
  const off = new Set(beh.off ?? []);
  for (const k of off) if (!(k in RULE_FLAGS)) throw new Error(`unknown rule flag: ${k}`);
  const tune = { ...TUNE_DEFAULTS, ...(beh.tune ?? {}) };
  for (const k of Object.keys(beh.tune ?? {})) if (!(k in TUNE_DEFAULTS)) throw new Error(`unknown tune key: ${k}`);
  return { on: (k) => !off.has(k), v: (k) => tune[k] };
}
