import { roleCounts } from '../game/config';
import { ROLES } from '../game/roles';
import type { Divination, GameState, PublicEvent, RoleId, WolfChatMsg } from '../game/types';

// プレイヤーが「知ってよい情報」だけを集めたもの。AIはこれ以外を一切見ない。
export interface PlayerObservation {
  readonly self: { readonly id: number; readonly name: string; readonly role: RoleId };
  readonly day: number;
  readonly phase: 'day' | 'vote' | 'night';
  readonly round: number;
  readonly config: { readonly n: number; readonly rounds: number; readonly roleCounts: Readonly<Record<RoleId, number>>; readonly noConsecutiveGuard: boolean; readonly day1Vote: boolean; readonly dialect: boolean; readonly humanSeat: number | null; readonly humanRep: number };
  readonly players: readonly { readonly id: number; readonly name: string; readonly alive: boolean }[];
  readonly events: readonly PublicEvent[]; // 公開情報のみ
  readonly priv: {
    readonly wolfMates?: readonly number[]; // 人狼のみ: 仲間
    readonly wolfChat?: readonly WolfChatMsg[]; // 人狼のみ: 夜の相談
    readonly masonMates?: readonly number[]; // 共有者のみ: 相方
    readonly seerResults?: readonly Divination[]; // 占い師のみ: 自分の占い結果
    readonly mediumResults?: readonly Divination[]; // 霊能者のみ: 処刑者の白黒
    readonly guardLog?: readonly { day: number; target: number }[]; // 狩人のみ
  };
}

export function buildObservation(state: GameState, pid: number, ctx: { phase: 'day' | 'vote' | 'night'; round?: number }): PlayerObservation {
  const me = state.players[pid];
  const priv: { -readonly [K in keyof PlayerObservation['priv']]: PlayerObservation['priv'][K] } = {};
  // ここだけが「真の役職」を参照してよい箇所。参照するのは自分自身の役職だけ。
  if (me.role === 'werewolf') {
    priv.wolfMates = state.players.filter((p) => p.id !== pid && ROLES[p.role].isWolf).map((p) => p.id);
    priv.wolfChat = state.priv.wolfChat.slice();
  } else if (me.role === 'mason') {
    priv.masonMates = state.players.filter((p) => p.id !== pid && p.role === 'mason').map((p) => p.id);
  } else if (me.role === 'seer') {
    priv.seerResults = (state.priv.seer[pid] || []).slice();
  } else if (me.role === 'medium') {
    priv.mediumResults = state.priv.executed.slice();
  } else if (me.role === 'hunter') {
    priv.guardLog = (state.priv.guard[pid] || []).slice();
  }
  return {
    self: { id: pid, name: me.name, role: me.role },
    day: state.day,
    phase: ctx.phase,
    round: ctx.round ?? 0,
    config: { n: state.config.n, rounds: state.config.rounds, roleCounts: roleCounts(state.config), noConsecutiveGuard: state.config.noConsecutiveGuard, day1Vote: state.config.day1Vote, dialect: state.config.dialect !== false, humanSeat: state.config.humanSeat, humanRep: state.config.humanRep ?? 0 },
    players: state.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive })),
    events: state.events.slice(),
    priv,
  };
}
