import { TUNE_BY_N, W_BY_N } from '../agents/flags';
import type { Behavior, GameConfig, RoleId, ScoreWeights } from './types';

// 既存プロジェクト(082_jinro3)の 9/13/15人構成を踏襲し、初心者向けに 5/7人を追加。
export const ROLE_PRESETS: Record<number, RoleId[]> = {
  5: ['werewolf', 'seer', 'villager', 'villager', 'villager'],
  7: ['werewolf', 'werewolf', 'seer', 'hunter', 'villager', 'villager', 'villager'],
  9: ['werewolf', 'werewolf', 'madman', 'seer', 'medium', 'hunter', 'villager', 'villager', 'villager'],
  // 13人: 村6 占 霊 狩 / 狼3 狂1 (共有者なし)
  13: ['werewolf', 'werewolf', 'werewolf', 'madman', 'seer', 'medium', 'hunter', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager'],
  // 15人: 村5 占 霊 狩 共2 / 狼3 狂1 / 妖狐1 (標準的な15人配役。第18版: 共有者なしだと村側25%・妖狐28〜44%で成り立たなかったので共有者2を入れた)
  15: ['werewolf', 'werewolf', 'werewolf', 'madman', 'fox', 'seer', 'medium', 'hunter', 'mason', 'mason', 'villager', 'villager', 'villager', 'villager', 'villager'],
};

// 判断の重み: ルール 75% / 性格 15% / 乱数 10%（合計1に正規化して使う）
export const DEFAULT_WEIGHTS: ScoreWeights = { rule: 0.75, personality: 0.15, noise: 0.1 };
export const DEFAULT_BEHAVIOR: Behavior = { seerCoProb: 0.95, madFakeProb: 0.9, madFakeMediumProb: 0.6, wolfFakeProb: 0.85, masonCoProb: 0.85, mediumCoDay1Prob: 0.85 }; // 霊能の初日CO(3-1進行の「1」)が標準。残りは疑われたときに吊り逃れCOする
// 人狼が占い師を騙る確率は人数で変える(1000試合の勝率で決定)。
//   13/15人: 騙りが標準(3-1が最多)。7人: 騙ったほうが人狼側の勝率が高い。5人・9人: 騙ると人狼側が不利。
export const WOLF_FAKE_BY_N: Record<number, number> = { 5: 0.2, 7: 0.85, 9: 0.4, 13: 0.85, 15: 0.85 };

// 登場キャラクター(席の順)。portrait は assets/portraits/<key>.webp(あれば立ち絵、なければ絵文字で表示)
// キャラクター: 覚えやすい都道府県。アイコンはその県の象徴(絵文字)。県ごとの立ち絵ができたら portrait: 'tokyo' のようにキーを足すと画像に切り替わる(assets/portraits/)
export const CHARACTERS: { name: string; emoji: string; portrait?: string; gender?: 'm' | 'f' }[] = [
  { name: '北海道', emoji: '🐄', portrait: 'hokkaido', gender: 'f' },
  { name: '東京', emoji: '🗼', portrait: 'tokyo', gender: 'm' },
  { name: '大阪', emoji: '🐙', portrait: 'osaka', gender: 'm' },
  { name: '京都', emoji: '⛩️', portrait: 'kyoto', gender: 'f' },
  { name: '沖縄', emoji: '🌺', portrait: 'okinawa', gender: 'm' },
  { name: '福岡', emoji: '🍜', portrait: 'fukuoka', gender: 'm' },
  { name: '愛知', emoji: '🏯', portrait: 'aichi', gender: 'm' },
  { name: '神奈川', emoji: '⛵', portrait: 'kanagawa', gender: 'f' },
  { name: '宮城', emoji: '🎋', portrait: 'miyagi', gender: 'm' },
  { name: '広島', emoji: '🍁', portrait: 'hiroshima', gender: 'f' },
  { name: '長野', emoji: '⛰️', portrait: 'nagano', gender: 'm' },
  { name: '新潟', emoji: '🌾', portrait: 'niigata', gender: 'f' },
  { name: '静岡', emoji: '🗻', portrait: 'shizuoka', gender: 'f' },
  { name: '兵庫', emoji: '🌉', portrait: 'hyogo', gender: 'm' },
  { name: '千葉', emoji: '🥜', portrait: 'chiba', gender: 'm' },
];
export const NAMES = CHARACTERS.map((c) => c.emoji + c.name);

export function makeConfig(n = 7, over: Partial<GameConfig> = {}): GameConfig {
  const roles = ROLE_PRESETS[n];
  if (!roles) throw new Error(`unsupported player count: ${n}`);
  return {
    n,
    roles: [...roles],
    rounds: 2,
    day1Vote: n >= 9, // 少人数(5・7人)は初日処刑なし。9人以上は初日から投票
    // 13人村だけ連続護衛あり。連続護衛なしだと、護衛成功の翌晩に占い師が必ず噛まれて村側が不利(均衡で人狼側61%)。
    // 連続護衛ありなら人狼が守られている相手を避け、占い騙りで狩人を迷わせる意味が生まれ、均衡で人狼側46%になる(docs/DESIGN.md 8章)
    noConsecutiveGuard: n !== 13,
    firstNightDivine: true,
    maxDays: 20,
    weights: { ...DEFAULT_WEIGHTS },
    behavior: { ...DEFAULT_BEHAVIOR, wolfFakeProb: WOLF_FAKE_BY_N[n] ?? DEFAULT_BEHAVIOR.wolfFakeProb, tune: { ...(TUNE_BY_N[n] ?? {}) }, w: { ...(W_BY_N[n] ?? {}) } },
    humanSeat: null,
    dialect: true,
    ...over,
  };
}

export function roleCounts(cfg: GameConfig): Record<RoleId, number> {
  const c: Record<RoleId, number> = { villager: 0, werewolf: 0, seer: 0, medium: 0, hunter: 0, madman: 0, mason: 0, fox: 0 };
  for (const r of cfg.roles) c[r]++;
  return c;
}
