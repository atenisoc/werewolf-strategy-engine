import type { Agent } from '../types';
import { RuleAgent, type AgentOpts } from '../agent';
import { exampleSkeptic } from './example-skeptic';

// ============================================================================
// AIバリアント(戦術の差し替え)の登録簿。
//
// 第三者が独自の戦術を試すための窓口。やることは2つだけ:
//   1. src/agents/variants/<name>.ts に AgentVariant を書く(example-skeptic.ts が見本)
//   2. この VARIANTS に登録する
// あとは `node dist/sim.js --compare <name>` で既存AI(baseline)と同じseedで対戦比較できる。
//
// 既存AI(baseline)の挙動はここでは一切変えない。バリアントは「別の名前で並べる」だけ。
// ============================================================================

export interface AgentVariant {
  name: string;
  description: string; // 1行。--variants で表示される
  create(o: AgentOpts): Agent; // 席ごとに呼ばれる。o.strategies / o.behavior を差し替えて RuleAgent を作るのが基本形
}

export const baseline: AgentVariant = {
  name: 'baseline',
  description: '既定のルールベースAI(本体と同じ)',
  create: (o) => new RuleAgent(o),
};

export const VARIANTS: Record<string, AgentVariant> = {
  baseline,
  [exampleSkeptic.name]: exampleSkeptic,
};

export function getVariant(name: string): AgentVariant {
  const v = VARIANTS[name];
  if (!v) throw new Error(`unknown agent variant: ${name} (available: ${Object.keys(VARIANTS).join(', ')})`);
  return v;
}

export function registerVariant(v: AgentVariant): void {
  if (VARIANTS[v.name]) throw new Error(`agent variant already registered: ${v.name}`);
  VARIANTS[v.name] = v;
}
