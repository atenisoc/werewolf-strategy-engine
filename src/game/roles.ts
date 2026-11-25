import type { Camp, Color, RoleId } from './types';

export interface RoleDef {
  id: RoleId;
  name: string;
  camp: Camp; // 勝利陣営
  isWolf: boolean; // 勝敗判定上の「人狼」か(狂人は false)
  seerColor: Color; // 占い・霊能の結果
  night: 'divine' | 'guard' | 'attack' | null;
  short: string;
  goal: string;
  tips: string;
}

// 役職を増やすときは、ここに定義を足し、agents/roles/ に戦略を足す。
export const ROLES: Record<RoleId, RoleDef> = {
  villager: {
    id: 'villager', name: '村人', camp: 'village', isWolf: false, seerColor: 'white', night: null, short: '村',
    goal: '村人陣営：人狼を全員処刑すれば勝ち。',
    tips: '特別な能力はありません。みんなの発言と投票をよく見て、人狼らしい人を探しましょう。占い師の結果が一番の手がかりです。',
  },
  werewolf: {
    id: 'werewolf', name: '人狼', camp: 'wolf', isWolf: true, seerColor: 'black', night: 'attack', short: '狼',
    goal: '人狼陣営：人狼の数が村人側と同数以上になれば勝ち。',
    tips: '正体を隠して村人のふりをします。夜に仲間と相談して1人襲撃できます。占い師を騙る（偽CO）のも有効な作戦です。',
  },
  seer: {
    id: 'seer', name: '占い師', camp: 'village', isWolf: false, seerColor: 'white', night: 'divine', short: '占',
    goal: '村人陣営：夜に1人占って「人狼かどうか」を知れます。',
    tips: '結果が白＝人狼ではない、黒＝人狼です。結果を公開する（CO）と信用されやすい反面、人狼に狙われます。偽物の占い師が出たら注意。妖狐がいる村では、占った相手が妖狐なら翌朝死にます（呪殺）。',
  },
  medium: {
    id: 'medium', name: '霊能者', camp: 'village', isWolf: false, seerColor: 'white', night: null, short: '霊',
    goal: '村人陣営：処刑された人が人狼だったかどうかがわかります。',
    tips: '処刑された人の白黒を知れます。占い師の結果が本当か確かめる材料になるので、結果は積極的に伝えましょう。',
  },
  hunter: {
    id: 'hunter', name: '狩人', camp: 'village', isWolf: false, seerColor: 'white', night: 'guard', short: '狩',
    goal: '村人陣営：夜に1人を人狼の襲撃から守れます。',
    tips: '本物の占い師を守るのが定番です。自分の役職は、よほどのことがない限り隠しておきましょう。',
  },
  mason: {
    id: 'mason', name: '共有者', camp: 'village', isWolf: false, seerColor: 'white', night: null, short: '共',
    goal: '村人陣営：2人1組。お互いが村人陣営だと最初から知っています。',
    tips: '相方は確実に人狼ではありません。2人でCOすれば「確定で白い人」として村の議論を引っ張れます。人狼に狙われやすくなるのが欠点。',
  },
  fox: {
    id: 'fox', name: '妖狐', camp: 'fox', isWolf: false, seerColor: 'white', night: null, short: '狐',
    goal: '妖狐陣営：村か人狼の勝利条件が満たされた時に生きていれば、妖狐の単独勝ち。',
    tips: '人狼に襲われても死にません。ただし占い師に占われると死にます（呪殺）。占いでは白と出ます。目立たず、最後まで生き残りましょう。',
  },
  madman: {
    id: 'madman', name: '狂人', camp: 'wolf', isWolf: false, seerColor: 'white', night: null, short: '狂',
    goal: '人狼陣営：人間ですが人狼側の勝ちを目指します（占いでは白と出ます）。',
    tips: '誰が人狼かは知りません。占い師を騙って村を混乱させるのが得意技。人狼が勝てば自分も勝ちです。',
  },
};

export const roleName = (r: RoleId) => ROLES[r].name;
