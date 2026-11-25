// 人間の人狼ログを、今のAIの発言種類(StatementKind)に分類する簡易分類器。
//   node scripts/classify_log.mjs path/to/log.txt
// 1行=1発言(「名前: 発言」や「名前 発言」の形。形式が違えば先頭の名前部分は無視して本文だけ見る)。
// 目的: 今のAIに「ない型」(分類できない発言)を列挙し、追加すべき発言の種類を見つける。文は保存・流用しない。
import { readFileSync } from 'node:fs';

const RULES = [
  ['co', /(占い師|霊能|霊媒|狩人|騎士|共有|狂人|村人)(CO|co|ＣＯ|です|だ|になります|やります)|^CO|COします|ＣＯ/],
  ['result', /(白|黒|○|●|人狼|村人|人間)(でした|だった|です|だ)|占い結果|霊能結果|霊結果|護衛(成功|先)|GJ/],
  ['vote_intent', /(投票|入れ|吊り|吊る|つる|処刑)(する|ます|たい|で|だ|しよう|ましょう|予定|先)|に票|票を|に入れる|吊りで/],
  ['accuse', /(怪しい|あやしい|黒い|黒目|人外|狼(だ|っぽい|に見える|目)|信用できない|偽|嘘|疑|不自然|違和感|きな臭|グレー(の中で|で)|吊り候補)/],
  ['defend', /(白い|白目|村目|村っぽい|信用|信じ|本物|真(目|だ|で)|かばう|擁護|疑わなくて|吊るのはもったいない|吊りたくない)/],
  ['agree', /(同意|同感|賛成|そう思う|その通り|わかる|同じ(意見|く)|乗る|に乗っ)/],
  ['disagree', /(反対|違う|そうは思わない|納得できない|おかしい|異論|いや、|えっ|は？|ちょっと待)/],
  ['ask', /(どう(思|見)|意見|聞きたい|教えて|理由(は|を)|なぜ|なんで|何で|\?|？|説明して|どこに入れ)/],
  ['self_defense', /(私は(村|白|人間|本物)|俺は(村|白|人間)|自分は(村|白)|信じて|疑われ|濡れ衣|違います|吊らないで|吊るなら|私を吊|俺を吊|冤罪)/],
  ['propose', /(ローラー|ロラ|グレラン|グレー吊り|指定|進行|方針|決め打ち|吊り順|護衛先は|黒ストップ|ライン戦)/],
  ['vote_review', /(昨日|前日).*(投票|票|入れ)|票(先|理由|が)|投票理由/],
  ['attack_review', /(噛|襲撃|かまれ|GJ).*(理由|意図|筋|意味|不思議|なぜ|どこ)|噛み筋|噛まれた/],
  ['medium_review', /霊能.*(黒|白).*(入れ|投票|かばっ)|黒(だった|を).*(かばっ|入れてな)/],
  ['line', /(ライン|仲間|つながって|繋がって|組んで|グル|相方|身内)/],
  ['count', /(残り|あと)\s*\d+|人数|縄|吊れる回数|吊り回数|PP|パワープレイ/],
  ['co_timing', /(後出し|早出し|出るのが(早|遅)|COが(早|遅)|様子を見てから出|対抗を見て)/],
  ['silent_point', /(黙って|発言(が|も)(少な|薄|ない)|喋って|寡黙|静か|何も言って)/],
  ['waver', /(ブレ|ぶれ|変わった|コロコロ|手のひら|さっきと|昨日は.*今日は)/],
  ['confirm', /(確定|破綻|決まり|確実|間違いない)/],
  ['wait', /(様子見|保留|まだ(わからない|分からない|判断|決め)|迷って|悩んで|難しい|見てから|見守)/],
  ['greet', /^(おは|よろ|こんにち|こんばん|お疲れ|はじめまして|初めまして|よろしく)/],
  ['meta', /(初心者|ルール|時間|投票は|ログ|リロード|突然死|遅刻|寝落ち|離席|戻り|ごめん|すみません|了解|りょ|おk|OK|ok|w$|笑|草|ｗ)/],
];

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/classify_log.mjs log.txt'); process.exit(1); }
const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const counts = {}; const un = []; const multi = [];
for (const raw of lines) {
  const body = raw.replace(/^[^:：]{1,16}[:：]\s*/, '').replace(/^\[[^\]]*\]\s*/, '');
  if (body.length < 2) continue;
  const hits = RULES.filter(([, re]) => re.test(body)).map(([k]) => k);
  const k = hits[0] ?? 'UNCLASSIFIED';
  counts[k] = (counts[k] ?? 0) + 1;
  if (!hits.length) un.push(body);
  if (hits.length >= 3) multi.push([hits.join('+'), body]);
}
console.log('発言数', lines.length);
console.log('種類別:');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`);
console.log(`\n分類できない発言(${un.length}件) = 今のAIにない型の候補:`);
for (const u of un) console.log('  - ' + u.slice(0, 80));
console.log(`\n複数の型が混ざる発言(${multi.length}件、人間らしい複合文):`);
for (const [k, b] of multi.slice(0, 30)) console.log(`  [${k}] ${b.slice(0, 80)}`);
