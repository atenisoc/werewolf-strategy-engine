import { roleName } from '../game/roles';
import type { RoleId } from '../game/types';
import type { BatchResult, GameRecord } from './batch';

const pct = (x: number | null | undefined) => (x == null ? '  -  ' : (x * 100).toFixed(1) + '%');

export function summaryText(res: BatchResult): string {
  const s = res.summary;
  const L: string[] = [];
  L.push(`試合数: ${s.games} (異常終了 ${s.errors})   人数: ${s.n}人`);
  L.push(`村人陣営勝率: ${pct(s.villageWinRate)}   人狼陣営勝率: ${pct(s.wolfWinRate)}${s.foxWinRate > 0 || s.config.roles.includes('fox') ? `   妖狐勝利: ${pct(s.foxWinRate)}` : ''}   決着つかず: ${pct(s.drawRate)}`);
  L.push(`平均ゲーム日数: ${s.avgDays.toFixed(2)}日`);
  L.push('');
  L.push('各役職の生存率(ゲーム終了時):');
  for (const [r, v] of Object.entries(s.roleSurvival)) L.push(`  ${roleName(r as RoleId)}: ${pct(v.rate)} (${v.survivedEnd}/${v.count})`);
  L.push('');
  L.push(`投票精度(村側が人狼に投票した割合): 全体 ${pct(s.voteAccuracy.overall)}`);
  for (const [r, v] of Object.entries(s.voteAccuracy.byRole)) L.push(`  ${roleName(r as RoleId)}: ${pct(v)}`);
  L.push('');
  if (s.rankAuc != null) L.push(`順位精度(AUC: 村側が人狼を村側より高く疑っていた割合、0.5=当てずっぽう): ${(s.rankAuc * 100).toFixed(1)}%`);
  if (s.rules) {
    L.push('\n推理ルールの精度(村側プレイヤーが付けた増減。人狼に+、村側に-なら正解。差=人狼への平均−村側への平均):');
    L.push('  件数   正解率   人狼率   人狼へ   村側へ    差   ルール');
    for (const r of s.rules.filter((x) => x.n >= 30)) {
      L.push(`  ${String(r.n).padStart(5)}  ${(r.hitRate * 100).toFixed(0).padStart(5)}%  ${(r.share * 100).toFixed(0).padStart(5)}%  ${r.onWolf.toFixed(1).padStart(6)}  ${r.onVillage.toFixed(1).padStart(6)}  ${(r.onWolf - r.onVillage).toFixed(1).padStart(5)}   ${r.key}`);
    }
  }
  L.push('人狼への疑惑度の推移(村側の平均。投票直前):');
  L.push('  日  人狼への疑惑  村側への疑惑  差');
  for (const t of s.trajectory.filter((x) => x.samples >= 5)) L.push(`  ${String(t.day).padStart(2)}  ${t.onWolf.toFixed(1).padStart(10)}  ${t.onVillage.toFixed(1).padStart(12)}  ${(t.onWolf - t.onVillage).toFixed(1).padStart(5)}`);
  L.push('');
  L.push('性格別(席数 / 村側の勝率 / 人狼側の勝率 / 投票精度):');
  for (const p of s.personalities) L.push(`  ${p.name.padEnd(4, '　')} ${String(p.seats).padStart(6)}  ${pct(p.villageSideWinRate)}  ${pct(p.wolfSideWinRate)}  ${pct(p.voteAccuracy)}${p.warning ? '  ⚠ ' + p.warning : ''}`);
  if (s.variants) {
    L.push('');
    L.push('AIバリアント別(混合対戦。席数 / 村側の勝率 / 人狼側の勝率 / 投票精度):');
    for (const v of s.variants) L.push(`  ${v.name.padEnd(18)} ${String(v.seats).padStart(6)}  ${pct(v.villageSideWinRate)}  ${pct(v.wolfSideWinRate)}  ${pct(v.voteAccuracy)}`);
  }
  if (res.anomalies.length) {
    L.push('');
    L.push(`⚠ 異常 ${res.anomalies.length}件 (先頭10件):`);
    for (const a of res.anomalies.slice(0, 10)) L.push(`  seed=${a.seed} [${a.kind}] ${a.message}`);
  } else L.push('\n異常なし。');
  return L.join('\n');
}

export function recordsToCsv(records: GameRecord[]): string {
  const head = 'seed,winner,days,n,roles,personalities,variants,alive_end,votes,votes_on_wolf,error';
  const rows = records.map((r) =>
    [r.seed, r.winner, r.days, r.roles.length, r.roles.join(';'), r.personalities.join(';'), (r.variants ?? []).join(';'), r.aliveEnd.map((x) => (x ? 1 : 0)).join(';'), r.votes.join(';'), r.votesOnWolf.join(';'), JSON.stringify(r.error ?? '')].join(','),
  );
  return [head, ...rows].join('\n');
}
