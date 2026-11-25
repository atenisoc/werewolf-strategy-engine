import type { Behavior, Color, DivineReason, Personality, RoleId, Statement, StatementKind, WolfPlan } from '../game/types';
import type { PlayerObservation } from '../observations/observation';
import type { ThinkEntry } from '../logs/think';
import type { Belief } from './belief';
import type { PersKind } from './personality';
import type { Rng } from '../util/rng';
import type { Flags } from './flags';

export type NightKind = 'divine' | 'guard' | 'attack';

// エンジンから見たAIの窓口。受け取るのは PlayerObservation だけ。
export interface Agent {
  readonly id: number;
  readonly personality: Personality;
  talk(obs: PlayerObservation): { st: Statement; text: string };
  vote(obs: PlayerObservation, candidates: number[]): number;
  night(obs: PlayerObservation, kind: NightKind): number;
  wolfPlan(obs: PlayerObservation): WolfPlan | null;
  suspicions(): number[] | null; // 疑惑度の現在値(統計用)
  ledger(): { label: string; delta: number; day: number }[][] | null; // 疑惑度の増減の台帳(ルール精度の集計用)
  log: ThinkEntry[];
}

// 行動候補。ルール得点(rule)に性格・乱数が加わって最終スコアになる。
export interface Cand {
  key: string;
  label: string;
  kind: StatementKind | 'vote' | 'night';
  pers: PersKind;
  rule: number; // 0〜100
  must?: boolean; // true なら他の候補より必ず優先する(占い結果の報告など、言わないと不自然なもの)
  heat: number; // 多数派度(0〜1)
  target?: number;
  st?: Statement;
}

export interface FakeSeerMem {
  plan: boolean;
  claim: 'seer' | 'medium'; // 何を騙るか
  results: { day: number; target: number; color: Color }[];
  reported: number;
  genDay: number;
}
export interface AgentMemory {
  coDone: boolean;
  seerCoPlan: boolean;
  reportedSeer: number;
  reportedMedium: number;
  askedCo: boolean;
  spoken: Map<string, number>; // 今日すでに言った(kind:target)の回数
  spokenDay: number;
  fake: FakeSeerMem;
  templates: Map<string, number[]>;
  lastReason?: string;
  intent?: { day: number; target: number }; // 今日「投票宣言」した相手(宣言どおりに投票しやすくする)
  whyOf: Record<number, DivineReason>; // 占い師: 誰をなぜ占ったか(結果報告のときに添える)
  gjReportedDay: number; // 狩人: 護衛成功を報告した日(平和な朝ごとに報告できる)
  hunterFake?: boolean; // 人狼: 狩人騙りをする/しないを決めたか(true=する)
}

export interface Ctx {
  obs: PlayerObservation;
  b: Belief;
  me: number;
  role: RoleId;
  day: number;
  round: number;
  rounds: number;
  alive: number[];
  others: number[];
  mem: AgentMemory;
  p: Personality;
  rng: Rng;
  beh: Behavior;
  mates: Set<number>; // 人狼: 仲間の人狼 / 共有者: 相方 (それ以外は空)
  dry: boolean; // true: ヒント計算用。状態を変えない
  f: Flags; // 推理ルールのON/OFF(検証用)
  name: (i: number) => string;
}

// 役職ごとの戦略。足りないものは省略でき、省略時は村人と同じ動きになる。
export interface RoleStrategy {
  init?(m: AgentMemory, ctx: { rng: Rng; beh: Behavior }): void;
  talkExtras?(ctx: Ctx): Cand[];
  targetOk?(ctx: Ctx, t: number, kind: 'accuse' | 'defend' | 'vote' | 'agree'): boolean;
  bonus?(ctx: Ctx, c: Cand): number;
  voteRule?(ctx: Ctx, t: number): number;
  nightCands?(ctx: Ctx, kind: NightKind): Cand[];
  wolfPlan?(ctx: Ctx): WolfPlan | null;
  internal?(ctx: Ctx, chosen: Cand): string[];
  onSpoke?(ctx: Ctx, c: Cand): void;
}
