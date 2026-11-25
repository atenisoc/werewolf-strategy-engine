import type { HumanResponse } from '../game/engine';

// 試合の再現コード。seed・人数・人間の入力だけで、同じ試合を完全に再生できる。
export interface ReplayCode {
  v: 1;
  seed: number;
  n: number;
  human: boolean;
  role?: string | null; // 人間の役職指定(v1互換のため省略可)
  rep?: number; // 人間の過去の騙り率(AIの警戒度。再現のため記録)
  inputs: HumanResponse[];
}

export function encodeReplay(c: ReplayCode): string {
  const json = JSON.stringify(c);
  return btoa(unescape(encodeURIComponent(json)));
}

export function decodeReplay(s: string): ReplayCode | null {
  try {
    const c = JSON.parse(decodeURIComponent(escape(atob(s.trim()))));
    if (c && c.v === 1 && Number.isFinite(c.seed) && Number.isFinite(c.n) && Array.isArray(c.inputs)) return c as ReplayCode;
  } catch {
    /* ignore */
  }
  return null;
}
