import type { Rng } from '../util/rng';

export type RoleId = 'villager' | 'werewolf' | 'seer' | 'medium' | 'hunter' | 'madman' | 'mason' | 'fox';
export type Camp = 'village' | 'wolf' | 'fox';
export type Color = 'white' | 'black';
export type Winner = Camp | 'draw';
export type Phase = 'night' | 'day' | 'vote' | 'morning';

// ---- 発言(Statement) ----
export type StatementKind =
  | 'accuse' // 疑う
  | 'defend' // かばう
  | 'agree' // 他者の疑いに賛成
  | 'wait' // 様子見
  | 'vote_intent' // 今日は○○に投票したい
  | 'ask_co' // 占い師はCOして
  | 'co' // 役職CO(占い結果つきの場合あり)
  | 'result' // 結果報告(占い/霊能。狩人は護衛成功の報告: target=守った相手)
  | 'propose' // 進行の提案(plan: ローラー/グレー吊り/黒先を吊る/霊能ローラー)
  | 'vote_review' // 昨日の投票への言及(target=投票した人, ref=その投票先)
  | 'attack_review' // 襲撃先の考察(target=襲われた人)
  | 'medium_review' // 霊能結果からの指摘(target=黒に投票していなかった人 など)
  | 'line' // ライン指摘(target と ref の票・発言が合いすぎている)
  | 'waver' // ブレの指摘(target が昨日は ref を疑っていたのに今日は別の人)
  | 'bite_logic' // 噛み筋の読み(ref=噛まれた人, target=その人が疑っていた/かばっていた人。color black=人狼寄り / white=白寄り)
  | 'count' // 人数カウント(n=生存, m=人狼の残り見込み)
  | 'confirm' // 確定の宣言(target=偽と確定した占い師CO, ref=根拠になった人: 噛まれた本物 など)
  | 'co_timing' // COの速さへの言及(target=占い師CO, tag early/late)
  | 'ask' // 指名して意見を聞く(target)
  | 'silent_point' // 沈黙の指摘(target=今日まだ発言していない人)
  | 'defend_self' // 弁護・反論(target=自分を疑った人。tag: vote_hist=自分の票を説明 / white=自分の白判定を根拠に / ask_back=根拠を聞き返す)
  | 'disagree'; // 反対(ref=疑った人, target=疑われた人。「refの{target}への疑いは違う」)

export type Plan = 'roller' | 'grey' | 'black' | 'medium_roller';
export type DivineReason = 'suspect' | 'quiet' | 'trusted' | 'fox';

export type ReasonKey =
  | 'seer_black'
  | 'counter_co'
  | 'fake_seer'
  | 'vote_hist'
  | 'vague'
  | 'late_change'
  | 'defend_wolf'
  | 'kill_contra'
  | 'broken' // 占いの黒が霊能結果(白)と食い違った=破綻
  | 'fake_hunter' // 狩人COなのに噛まれない
  | 'hunter_gj' // 狩人COの翌朝が平和(護衛成功)、または対抗の狩人COが黒だった=本物寄り
  | 'seer_unbitten' // 占いCOが噛まれないまま夜を越している
  | 'fake_confirmed' // 本物の占い師が噛まれたので、残った占いCOは偽物
  | 'fake_mason'
  | 'self_black' // 自分(占い師CO)が黒を出した相手
  | 'rival_claim' // 同じ役職を名乗る対抗。本物は自分なので向こうは偽物
  | 'follow';

export interface Statement {
  kind: StatementKind;
  target?: number;
  ref?: number; // agree: 誰の意見に賛成か
  claim?: RoleId; // co/result: 名乗る役職
  color?: Color; // co/result: 判定
  reason?: ReasonKey; // 公開してよい根拠
  plan?: Plan; // propose: 提案の内容
  why?: DivineReason; // result(占い): 占った理由
  tag?: string; // co_timing: 'early' | 'late' など
  n?: number; // count: 生存人数
  m?: number; // count: 人狼の残り見込み
}

// ---- 公開イベント (全員が見られる情報) ----
export type PublicEvent =
  | { t: 'phase'; day: number; phase: Phase }
  | { t: 'say'; day: number; round: number; by: number; st: Statement; text: string }
  | { t: 'vote'; day: number; round: number; by: number; target: number }
  | { t: 'execute'; day: number; target: number; votes: number }
  | { t: 'death'; day: number; target: number } // 夜の死亡(襲撃死・呪殺。原因は公開されない)
  | { t: 'peace'; day: number } // 犠牲者なし
  | { t: 'end'; winner: Winner };

// ---- 役職ごとの非公開情報 ----
export interface Divination {
  day: number;
  target: number;
  color: Color;
}
// 人狼の作戦(初夜の会議で決める)
export interface WolfPlan {
  fakeSeer: number | null; // 占い師を騙る人狼(null=騙らない)
  kakoi: boolean; // 囲い: 偽占いで仲間に白を出す
  cut: boolean; // 身内切り: 吊られそうな仲間には自分も投票して村人のふりをする
}
export interface WolfChatMsg {
  day: number;
  by: number;
  kind: 'plan' | 'target' | 'attack'; // target=各人狼の提案 / attack=その夜に実際に決まった襲撃先(1夜1件)
  fakeSeer?: number | null;
  kakoi?: boolean;
  cut?: boolean;
  target?: number;
}
export interface PrivateNote {
  idx: number; // events.length at the time
  to: number;
  text: string;
}

// ---- 設定 ----
export interface ScoreWeights {
  rule: number;
  personality: number;
  noise: number;
}
export interface Behavior {
  seerCoProb: number; // 本物の占い師がCOする確率
  madFakeProb: number; // 狂人が占い師を騙る確率
  madFakeMediumProb: number; // 狂人が霊能者を騙る確率(占い騙りをしないときに判定)
  wolfFakeProb: number; // 人狼が占い師を騙る確率
  masonCoProb: number; // 共有者が初日にCOする確率
  mediumCoDay1Prob: number; // 霊能者が結果の出る前(初日)にCOする確率
  off?: string[]; // 無効化する推理ルール(検証用。RULE_FLAGS 参照)
  tune?: Record<string, number>; // 数値パラメータの上書き(検証用。agents/flags.ts の TUNE_DEFAULTS 参照)
  w?: Record<string, number>; // 村側推理の重み(agents/belief.ts の W)の上書き(検証・調整用)
}
export interface GameConfig {
  n: number;
  roles: RoleId[];
  rounds: number; // 1日の発言ラウンド数
  day1Vote: boolean;
  noConsecutiveGuard: boolean; // 同じ人を2晩続けて護衛できない
  firstNightDivine: boolean;
  maxDays: number;
  weights: ScoreWeights;
  behavior: Behavior;
  humanSeat: number | null;
  humanRep?: number; // 人間プレイヤーの「過去の試合での役職騙り率」(0〜1)。AIが人間のCOを警戒する度合い。再現コードに含める(同じ値なら同じ試合)
  humanRole?: RoleId | null; // 人間の席の役職を指定(省略時はseedで決まる)
  dialect?: boolean; // 県ごとの口調(方言)を発言に乗せる(既定true。文章だけで判断には影響しない)
  personalities?: string[]; // 席ごとの性格プリセットキー(省略時はseedから決定)
}

export interface Personality {
  key: string;
  name: string;
  aggression: number;
  trust: number;
  follow: number;
  noise: number;
}

export interface Player {
  id: number;
  name: string;
  role: RoleId;
  alive: boolean;
  personalityKey: string;
}

// ---- 真のゲーム状態 (AIには絶対に渡さない) ----
export interface GameState {
  seed: number;
  config: GameConfig;
  players: Player[];
  personalities: Personality[];
  day: number;
  phase: Phase;
  events: PublicEvent[];
  notes: PrivateNote[];
  priv: {
    seer: Record<number, Divination[]>;
    executed: Divination[]; // 処刑者の霊能結果
    guard: Record<number, { day: number; target: number }[]>;
    wolfChat: WolfChatMsg[];
  };
  winner: Winner | null;
  rng: Rng; // ゲーム進行(同票決着など)用
}
