import type { PlayerObservation } from '../observations/observation';
import type { Statement } from '../game/types';

// 発言の形式チェック。AIの不正な出力(死者を指名など)はここで検出して異常として扱う。
export function validateStatement(st: Statement, obs: PlayerObservation): string | null {
  const alive = new Set(obs.players.filter((p) => p.alive).map((p) => p.id));
  // 形式の検証: 種類・役職・色は列挙値、対象IDは実在する整数(人間の再現コード入力からも不正値が来うる)
  const KINDS = new Set(['accuse', 'defend', 'agree', 'wait', 'vote_intent', 'ask_co', 'co', 'result', 'propose', 'vote_review', 'attack_review', 'medium_review', 'line', 'waver', 'bite_logic', 'count', 'confirm', 'co_timing', 'ask', 'silent_point', 'defend_self', 'disagree']);
  if (!KINDS.has(st.kind)) return `unknown kind ${String(st.kind)}`;
  const validId = (x: unknown) => x == null || (Number.isInteger(x) && (x as number) >= 0 && (x as number) < obs.players.length);
  if (!validId(st.target) || !validId(st.ref)) return 'target/ref out of range';
  if (st.claim != null && !['seer', 'medium', 'hunter', 'mason'].includes(st.claim)) return `invalid claim ${String(st.claim)}`;
  if (st.color != null && st.color !== 'white' && st.color !== 'black') return 'invalid color';
  if (st.plan != null && !['roller', 'grey', 'black', 'medium_roller'].includes(st.plan)) return 'invalid plan';
  const needsTarget = ['accuse', 'defend', 'agree', 'vote_intent', 'vote_review', 'medium_review', 'line', 'waver', 'bite_logic', 'confirm', 'co_timing', 'ask', 'silent_point', 'defend_self', 'disagree'].includes(st.kind);
  if (needsTarget) {
    if (st.target == null || !alive.has(st.target)) return `invalid target for ${st.kind}`;
    if (st.target === obs.self.id) return `self target for ${st.kind}`;
  }
  if (st.kind === 'line') {
    if (st.ref == null || !alive.has(st.ref) || st.ref === st.target || st.ref === obs.self.id) return 'invalid ref for line';
  }
  if (st.kind === 'vote_review' && st.ref == null) return 'ref required for vote_review';
  if (st.kind === 'disagree' && (st.ref == null || !alive.has(st.ref) || st.ref === st.target || st.ref === obs.self.id)) return 'disagree needs ref (the accuser)';
  if (st.kind === 'waver' && (st.ref == null || st.ref === st.target)) return 'ref required for waver';
  if (st.kind === 'bite_logic' && (st.ref == null || alive.has(st.ref) || !st.color)) return 'bite_logic needs a dead ref and color';
  if (st.kind === 'co_timing' && st.tag !== 'early' && st.tag !== 'late') return 'co_timing needs tag';
  if (st.kind === 'count' && (st.n == null || st.m == null)) return 'count needs n/m';
  if (st.kind === 'attack_review' && (st.target == null || alive.has(st.target))) return 'attack_review target must be a dead player';
  if (st.kind === 'propose') {
    if (!st.plan) return 'plan required';
    if (st.plan === 'black' && (st.target == null || !alive.has(st.target) || st.target === obs.self.id)) return 'invalid target for propose black';
  }
  if (st.kind === 'co' || st.kind === 'result') {
    if (!st.claim) return 'claim required';
    if (st.claim === 'hunter') {
      if (st.kind === 'result' && (st.target == null || !alive.has(st.target) || st.target === obs.self.id)) return 'invalid guard target';
    } else if (st.target != null) {
      if (!st.color) return 'color required';
      if (st.target === obs.self.id) return 'self divine';
    }
  }
  return null;
}

export function validateVote(target: number, candidates: number[]): string | null {
  return candidates.includes(target) ? null : `invalid vote target ${target}`;
}
