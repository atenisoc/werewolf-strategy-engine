// seed再現のための乱数。用途ごとに独立した乱数列(stream)を切り出す。
// 例: streamRng(seed,'setup') は役職配置、streamRng(seed,'agent:3') は3番プレイヤーのAI判断。
// AIの判断回数が変わっても他の乱数列がずれないので、再現性とデバッグ性が高い。

export interface Rng {
  (): number; // [0,1)
  int(n: number): number; // 0..n-1
  pick<T>(a: readonly T[]): T;
  gauss(): number; // 標準正規
  shuffle<T>(a: T[]): T[]; // in place
  chance(p: number): boolean;
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mix(a: number, b: number): number {
  let x = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0 || 1;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0; // mulberry32
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  const f = (() => next()) as Rng;
  f.int = (n: number) => Math.floor(f() * n);
  f.pick = <T,>(arr: readonly T[]) => arr[f.int(arr.length)];
  f.gauss = () => {
    let u = 0,
      v = 0;
    while (u === 0) u = f();
    while (v === 0) v = f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  f.shuffle = <T,>(arr: T[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = f.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  f.chance = (p: number) => f() < p;
  return f;
}

export function streamRng(seed: number, label: string): Rng {
  return makeRng(mix(seed >>> 0, hashString(label)));
}
