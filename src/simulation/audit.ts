import { ROLES } from '../game/roles';
import { checkWinner } from '../game/engine';
import type { GameState } from '../game/types';
import { buildObservation } from '../observations/observation';

// 情報漏洩チェック(非干渉テスト):
//   「他人の役職を入れ替えても、自分の観測は変わらない」ことを確認する。
//   観測に他人の真の役職が混ざっていれば、入れ替えで差が出て検出できる。
export function auditLeaks(state: GameState): string[] {
  const problems: string[] = [];
  for (const me of state.players) {
    const base = JSON.stringify(buildObservation(state, me.id, { phase: 'day' }));
    // 観測の中に「role」キーは自分の1つだけのはず
    const roleKeys = (base.match(/"role":/g) || []).length;
    if (roleKeys !== 1) problems.push(`player ${me.id}: observation has ${roleKeys} "role" keys`);
    // 入れ替え対象: 他人同士。人狼(共有者)は仲間の情報が観測に入るので、仲間以外同士だけ入れ替える。
    const known = (r: string) => (me.role === 'werewolf' && ROLES[r as keyof typeof ROLES].isWolf) || (me.role === 'mason' && r === 'mason');
    const others = state.players.filter((p) => p.id !== me.id && !known(p.role));
    for (let i = 0; i + 1 < others.length; i += 2) {
      const a = others[i];
      const b = others[i + 1];
      if (a.role === b.role) continue;
      const swapped: GameState = { ...state, players: state.players.map((p) => (p.id === a.id ? { ...p, role: b.role } : p.id === b.id ? { ...p, role: a.role } : p)) };
      const after = JSON.stringify(buildObservation(swapped, me.id, { phase: 'day' }));
      if (after !== base) {
        problems.push(`player ${me.id}(${me.role}): observation depends on roles of ${a.id}/${b.id}`);
        break;
      }
    }
  }
  return problems;
}

// 試合の整合性チェック
export function auditInvariants(state: GameState): string[] {
  const p: string[] = [];
  const dead = new Set<number>();
  for (const e of state.events) {
    if (e.t === 'execute' || e.t === 'death') {
      if (dead.has(e.target)) p.push(`player ${e.target} died twice`);
      dead.add(e.target);
    }
    if (e.t === 'say' && dead.has(e.by)) p.push(`dead player ${e.by} spoke`);
    if (e.t === 'vote' && (dead.has(e.by) || dead.has(e.target))) p.push(`invalid vote ${e.by}->${e.target}`);
  }
  for (const pl of state.players) if (pl.alive === dead.has(pl.id)) p.push(`alive flag mismatch for ${pl.id}`);
  const w = checkWinner(state);
  if (state.winner !== 'draw' && w !== state.winner) p.push(`winner mismatch: ${state.winner} vs ${w}`);
  if (state.winner === 'draw') p.push('game did not finish within maxDays');
  return p;
}
