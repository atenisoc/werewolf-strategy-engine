import type { RoleId } from '../game/types';
import { roleName } from '../game/roles';

// AIの判断ログ。1回の判断(発言/投票/夜行動)ごとに1件。
export interface ThinkCandidate {
  label: string;
  rule: number; // ルール由来の得点(重み付け後)
  personality: number; // 性格由来
  noise: number; // 乱数由来
  total: number;
}
export interface ThinkSusp {
  id: number;
  name: string;
  value: number; // 疑惑度
  items: { label: string; delta: number }[]; // 主な理由
}
export interface ThinkEntry {
  day: number;
  phase: 'talk' | 'vote' | 'night' | 'wolfplan';
  round: number;
  playerId: number;
  playerName: string;
  role: RoleId;
  personality: string;
  suspicion: ThinkSusp[];
  candidates: ThinkCandidate[];
  chosen: string;
  text?: string; // 実際に表で発言した内容
  internal?: string[]; // 内部で認識している真実(人狼/狂人など)。表向きと区別して記録
}

const sign = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(1);
const PH: Record<ThinkEntry['phase'], string> = { talk: '発言', vote: '投票', night: '夜行動', wolfplan: '人狼の作戦' };

export function formatThink(e: ThinkEntry): string {
  const L: string[] = [];
  const when = e.day === 0 ? '初夜' : `${e.day}日目`;
  L.push(`■ ${e.playerName} [${roleName(e.role)}/${e.personality}] ${when} ${PH[e.phase]}${e.phase === 'talk' ? `(ラウンド${e.round + 1})` : ''}`);
  if (e.internal?.length) for (const s of e.internal) L.push(`  【内部】${s}`);
  for (const s of e.suspicion) {
    L.push(`  ${s.name} 疑惑度 ${s.value.toFixed(0)}`);
    for (const it of s.items) L.push(`      ${it.delta >= 0 ? '+' : '-'} ${it.label} ${sign(it.delta)}`);
  }
  L.push('  候補:');
  for (const c of e.candidates) {
    L.push(`    ${c.label === e.chosen ? '★' : '・'} ${c.label}  ルール${sign(c.rule)} 性格${sign(c.personality)} 乱数${sign(c.noise)} = ${c.total.toFixed(1)}`);
  }
  L.push(`  最終判断: ${e.chosen}${e.text ? ` →「${e.text}」` : ''}`);
  return L.join('\n');
}
