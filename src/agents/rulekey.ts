// 台帳ラベルを「ルールの種類」に正規化する(名前と数字を伏せる)。
// 精度集計(--rules)と、学習したルール倍率(rule-scale.gen.ts)の両方で同じ鍵を使う。
export function ruleKey(label: string, names: readonly string[]): string {
  let s = label;
  for (const nm of names) if (nm) s = s.split(nm).join('○');
  return s.replace(/\d+(\.\d+)?/g, '#');
}
