#!/bin/bash
# 均衡探索ループ: 人狼側の数値を人狼勝率で調整 → 村側のルール倍率を再学習 → 繰り返す
#   bash scripts/equilibrium.sh 13 2   (人数, ラウンド数)
# 結果: 人狼側は tune-result.json、村側は src/agents/rule-scale.gen.ts(人数のエントリ)を書き換える
set -e
N=$1; ROUNDS=${2:-2}; BLEND=${3:-1}
for r in $(seq 1 $ROUNDS); do
  echo "== round $r: wolves"
  node scripts/tune.mjs --n $N --games 1000 --passes 1 --target tune --objective wolf --keys kakoiP,mateWhiteP,seerAttackW,seerHoldW,mediumBiteW,hunterAttackW,trustAttackW,fakeBlackP,matesCutHeat,wolfHunterFakeP --factors 0.5,1.5 | grep -E "baseline|採用|最終"
  node -e "
    const fs=require('fs'); const r=JSON.parse(fs.readFileSync('tune-result.json','utf8'));
    let s=fs.readFileSync('src/agents/flags.ts','utf8');
    const m=s.match(/export const TUNE_BY_N[^=]*= (\{[\s\S]*?\n\});/); const cur=eval('('+m[1]+')');
    cur[$N]={...(cur[$N]||{}), ...r.changed};
    s=s.replace(m[0], 'export const TUNE_BY_N: Record<number, Record<string, number>> = '+JSON.stringify(cur,null,2)+';');
    fs.writeFileSync('src/agents/flags.ts', s); console.log('TUNE_BY_N['+$N+']=', JSON.stringify(cur[$N]));"
  npm run build >/dev/null
  echo "== round $r: village relearn"
  node dist/sim.js --n $N --games 3000 --seed $((30000+r*1000)) --dump /tmp/feat_eq.jsonl --off v_learned_scale >/dev/null 2>&1
  python3 scripts/learn.py /tmp/feat_eq.jsonl --out /tmp/scale_eq.ts --min 800 | sed -n 2p
  python3 - <<PY
import json,re
p='src/agents/rule-scale.gen.ts'; src=open(p,encoding='utf8').read()
by=json.loads(re.search(r'= (\{.*\});',src,re.S).group(1))
a=json.loads(re.search(r'= (\{.*?\});',open('/tmp/scale_eq.ts',encoding='utf8').read(),re.S).group(1))
for k in list(a):
    if k.startswith('自分の占いで'): a[k]=1.0
    else: a[k]=round(1+$BLEND*(a[k]-1),2)
by['$N']=a
head=src[:src.index('export const')]
open(p,'w',encoding='utf8').write(head+'export const RULE_SCALE_BY_N: Record<string, Record<string, number>> = '+json.dumps(by,ensure_ascii=False,indent=1)+';\n')
PY
  npm run build >/dev/null
  node dist/sim.js --n $N --games 2000 --seed 1 | grep -E "村人陣営|AUC"
done
