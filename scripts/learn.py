# 推理ルールの倍率をロジスティック回帰で学習する。
#   node dist/sim.js --n 13 --games 3000 --seed 10001 --dump feat.jsonl --off v_learned_scale
#   python3 scripts/learn.py feat.jsonl [--out src/agents/rule-scale.gen.ts] [--min 1500]
# 行: {"y":1/0(人狼か), "susp":現在の疑惑度, "f":{ルール鍵: 増分の合計}}
# 学習は「増分の合計」を特徴量にした L2 ロジスティック回帰。係数の比が「そのルールの増分1点の価値」。
# 倍率 = 係数 / 基準係数(増分の総量で重み付けした平均)。現在の疑惑度の尺度を保ちつつ、当たるルールを強く・外れるルールを弱くする。
import json, sys, numpy as np
from collections import Counter
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
args = sys.argv[1:]
src = args[0]; out = None; mn = 1500
if '--out' in args: out = args[args.index('--out') + 1]
if '--min' in args: mn = int(args[args.index('--min') + 1])
rows = [json.loads(l) for l in open(src, encoding='utf8') if l.strip()]
cnt = Counter(); mass = Counter()
FIXED = {'初期値(人数比)', '第一印象(乱数)'}
for r in rows:
    for k, v in r['f'].items():
        if k in FIXED: continue
        cnt[k] += 1; mass[k] += abs(v)
keys = [k for k, c in cnt.items() if c >= mn]
idx = {k: i for i, k in enumerate(keys)}
X = np.zeros((len(rows), len(keys) + 1), dtype=np.float32)
y = np.array([r['y'] for r in rows], dtype=np.int8)
base = np.zeros(len(rows), dtype=np.float32)
for i, r in enumerate(rows):
    for k, v in r['f'].items():
        if k == '第一印象(乱数)': X[i, -1] = v
        elif k in idx: X[i, idx[k]] = v
    base[i] = r['susp']
seeds = np.array([r['seed'] for r in rows]); split = np.quantile(seeds, 0.8)
tr = seeds < split; te = ~tr
clf = LogisticRegression(C=1.0, max_iter=2000)
clf.fit(X[tr], y[tr])
p = clf.decision_function(X[te])
print(f'rows {len(rows)}  rules {len(keys)}  train {tr.sum()} test {te.sum()}')
print(f'AUC 現在の疑惑度: {roc_auc_score(y[te], base[te]):.4f}   学習モデル: {roc_auc_score(y[te], p):.4f}')
coef = clf.coef_[0]
ref = float(np.average(coef[:-1], weights=[mass[k] for k in keys]))
print(f'基準係数 {ref:.4f}  第一印象の係数 {coef[-1]:.4f}')
scale = {}
print(f'{"倍率":>6} {"係数":>8} {"件数":>7}  ルール')
for k in sorted(keys, key=lambda k: -cnt[k]):
    m = coef[idx[k]] / ref if ref > 0 else 1.0
    m = float(np.clip(m, 0.0, 3.0))
    scale[k] = round(m, 2)
    print(f'{m:6.2f} {coef[idx[k]]:8.4f} {cnt[k]:7d}  {k}')
if out:
    with open(out, 'w', encoding='utf8') as f:
        f.write('// 自動生成(scripts/learn.py)。推理ルールごとの倍率(ロジスティック回帰で学習)。直接編集しない。\n')
        f.write('// 鍵は rulekey.ts の ruleKey()。未知のルールは 1(そのまま)。\n')
        f.write('export const RULE_SCALE: Record<string, number> = ' + json.dumps(scale, ensure_ascii=False, indent=2) + ';\n')
    print('wrote', out)
