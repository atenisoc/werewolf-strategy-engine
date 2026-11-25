import { RuleAgent } from '../agent';
import type { Cand, RoleStrategy } from '../types';
import type { AgentVariant } from './index';

// ============================================================================
// バリアントの見本: 「疑り深い村人」
//
// 2つの差し替え方法を1つのファイルで示す。
//   (A) 推理の重み(belief.ts の W)を上書きする   … 数値を変えるだけ
//   (B) 役職戦略(RoleStrategy)を差し替える        … 発言・投票・夜行動の候補を足す/変える
// どちらも既定AI(baseline)のコードには触れない。
//
// 試し方:  node dist/sim.js --compare example-skeptic --n 9 --games 1000
//          (同じseedで baseline と example-skeptic を全席に入れた試合を比べる)
//          node dist/sim.js --vs example-skeptic --n 9 --games 1000
//          (1つの村に両方を混ぜて、席ごとの勝率を比べる)
// ============================================================================

// (B) 村人の戦術: 初日の最初の発言で占い師にCOを促す候補を強めに出す
const skepticVillager: RoleStrategy = {
  talkExtras(ctx): Cand[] {
    if (ctx.day !== 1 || ctx.mem.askedCo) return [];
    // rule は 0〜100 の「ルール上の望ましさ」。性格と乱数が加わって最終スコアになる
    return [{ key: 'ask_co', label: '占い師にCOを促す(疑り深い村人)', kind: 'ask_co', pers: 'neutral', rule: 60, heat: 0, st: { kind: 'ask_co' } }];
  },
};

export const exampleSkeptic: AgentVariant = {
  name: 'example-skeptic',
  description: '見本: 占い師の白判定を信じにくく(seerWhite 60→30)、村人が初日にCOを促す',
  create: (o) =>
    new RuleAgent({
      ...o,
      // (A) 重みの上書き。キー一覧は src/agents/belief.ts の W を参照
      behavior: { ...o.behavior, w: { ...(o.behavior.w ?? {}), seerWhite: 30 } },
      // (B) 役職戦略の差し替え。書かなかった役職は既定のまま
      strategies: { villager: skepticVillager },
    }),
};
