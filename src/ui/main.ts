import { CHARACTERS, makeConfig, ROLE_PRESETS } from '../game/config';
import { BGS, CARDS, EVENTS, NIGHTS, PORTRAITS } from './assets.gen';
import type { HumanRequest, HumanResponse } from '../game/engine';
import { ROLES } from '../game/roles';
import { Session } from '../game/session';
import type { Color, PublicEvent, RoleId, Statement } from '../game/types';
import { formatThink } from '../logs/think';
import { decodeReplay, encodeReplay } from '../logs/replay';
import { BatchRunner, type BatchResult } from '../simulation/batch';
import { recordsToCsv, summaryText } from '../simulation/report';
import { clear, download, h, $ } from './dom';
import { RULES_QUICK } from './guide';

// ============================================================================
//  画面。ゲームロジックは game/ ・ agents/ にあり、ここは表示と入力だけ。
// ============================================================================

let S: Session | null = null;
let human: number | null = null;
let shownEv = 0;
let shownNote = 0;
let timer: number | null = null;
let paused = false;
let curSeed = 0;
let curN = 7;
let curRole: RoleId | null = null;
let voteBlock: { key: string; el: HTMLElement } | null = null;
let isReplay = false; // 再現コード/再生からの試合は戦績に数えない
let statsDone = false;

const SPEED: Record<string, number> = { slow: 1100, mid: 550, fast: 220, max: 25 };
const cw = (c: Color | undefined) => (c === 'black' ? '黒' : '白');
const roleTag = (r: RoleId) => h('span', { class: `rb ${r}` }, ROLES[r].short);
// キャラクターの表示: 立ち絵があれば画像、なければ絵文字
function portraitUrl(id: number): string | null {
  const key = CHARACTERS[id]?.portrait;
  return key && PORTRAITS[key] ? PORTRAITS[key] : null;
}
function avatar(id: number, size = 28): HTMLElement {
  const url = portraitUrl(id);
  const c = CHARACTERS[id];
  if (url) return h('img', { class: 'av', src: url, alt: '', width: String(size), height: String(size), style: `width:${size}px;height:${size}px` });
  return h('span', { class: 'av emo', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.62)}px` }, c?.emoji ?? '');
}
// 名前(絵文字なし)
const plainName = (id: number) => CHARACTERS[id]?.name ?? String(id);
function nameEl(id: number, size = 28, suffix = ''): HTMLElement {
  return h('span', { class: 'who-nm' }, avatar(id, size), h('span', {}, plainName(id) + suffix));
}

const sel = (id: string) => $<HTMLSelectElement>(id);
const inp = (id: string) => $<HTMLInputElement>(id);

function pref(key: string, val?: string): string | null {
  try {
    if (val !== undefined) localStorage.setItem('rbw.' + key, val);
    return localStorage.getItem('rbw.' + key);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 開始
function newSeed(): number {
  return Math.floor(Math.random() * 90000) + 10000;
}

function fillRoleSel(n: number) {
  const s = sel('roleSel');
  const cur = s.value;
  clear(s);
  s.append(h('option', { value: '' }, 'おまかせ（seedで決まる）'));
  for (const r of [...new Set(ROLE_PRESETS[n] ?? [])]) s.append(h('option', { value: r }, ROLES[r].name));
  // 既定は村人(「おまかせ」は明示的に選んだときだけ残す)
  s.value = cur && Array.from(s.options).some((op) => op.value === cur) ? cur : 'villager';
}

// 人間の「役職騙り率」(過去の試合でCOした回数のうち、本当の役職と違ったCOの割合)。AIが人間のCOを警戒する材料
type Rep = { claims: number; fakes: number };
function loadRep(): Rep { try { return { claims: 0, fakes: 0, ...JSON.parse(pref('rep') ?? '{}') }; } catch { return { claims: 0, fakes: 0 }; } }
function repRate(r: Rep): number { return r.claims >= 3 ? Math.round((r.fakes / r.claims) * 100) / 100 : 0; }
let curRep = 0;
function startGame(o: { seed?: number; n?: number; play?: boolean; role?: RoleId | null; inputs?: HumanResponse[]; rep?: number } = {}) {
  stopTimer();
  const n = o.n ?? Number(sel('nSel').value);
  const play = o.play ?? sel('modeSel').value === 'play';
  fillRoleSel(n);
  if (o.role !== undefined) sel('roleSel').value = o.role ?? '';
  const role = (sel('roleSel').value || null) as RoleId | null;
  curRole = play ? role : null;
  const seedText = inp('seedInput').value.trim();
  const seed = o.seed ?? (seedText && Number.isFinite(Number(seedText)) ? Number(seedText) : newSeed());
  curSeed = seed;
  curN = n;
  inp('seedInput').value = String(seed);
  sel('nSel').value = String(n);
  sel('modeSel').value = play ? 'play' : 'watch';
  pref('n', String(n));
  pref('mode', play ? 'play' : 'watch');
  human = play ? 0 : null;
  curRep = o.rep ?? (human != null ? repRate(loadRep()) : 0);
  const cfg = makeConfig(n, { humanSeat: human, humanRole: curRole, dialect: inp('dialectChk').checked, humanRep: curRep });
  S = new Session(seed, cfg, o.inputs ?? []);
  isReplay = !!(o.inputs && o.inputs.length);
  statsDone = false;
  shownEv = 0;
  shownNote = 0;
  voteBlock = null;
  paused = false;
  clear($('feed'));
  ensureBoardSec();
  clear($('action'));
  $('endSheet').hidden = true;
  $('setupSheet').hidden = true;
  $('resultBtn').hidden = true;
  feedFilter = null;
  morningPicDay = -1;
  $('filterBar').hidden = true;
  document.querySelector('.app')?.classList.remove('night');
  $('pauseBtn').textContent = '⏸';
  $('phaseNow').textContent = human == null ? '👀 観戦' : '開始';
  try {
    history.replaceState(null, '', `#seed=${seed}&n=${n}&mode=${play ? 'play' : 'watch'}${curRole ? `&role=${curRole}` : ''}`);
  } catch {
    /* ignore */
  }
  renderBanner();
  renderSide();
  showStatus(human == null ? '👀 観戦中（⏩で最速）' : '⏳ 進行中… あなたの番になるとここに選択肢が出ます');
  scheduleTick(0);
}

function planText(): string {
  const pm = S?.state.priv.wolfChat.find((m) => m.kind === 'plan');
  if (!pm) return '';
  const fake = pm.fakeSeer == null ? '占い騙りなし' : `${plainName(pm.fakeSeer)}が占い師を騙る`;
  return `${fake}／囲い${pm.kakoi ? 'あり' : 'なし'}／身内切り${pm.cut === false ? 'なし' : 'あり'}`;
}
function compText(): string {
  if (!S) return '';
  const cnt = S.state.config.roles.reduce<Record<string, number>>((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {});
  return Object.entries(cnt).map(([r, c]) => `${ROLES[r as RoleId].name}${c}`).join(' / ') + (S.state.config.day1Vote ? '' : '（初日は処刑なし）') + (S.state.config.noConsecutiveGuard ? '' : '（連続護衛あり）');
}
function matesText(): string | null {
  if (!S || human == null) return null;
  const me = S.state.players[human];
  const mates = me.role === 'werewolf' ? S.state.players.filter((p) => p.id !== human && ROLES[p.role].isWolf).map((p) => plainName(p.id))
    : me.role === 'mason' ? S.state.players.filter((p) => p.id !== human && p.role === 'mason').map((p) => plainName(p.id)) : [];
  if (!mates.length) return null;
  return me.role === 'mason' ? `👥 相方: ${mates.join('、')}` : `🐺 仲間: ${mates.join('、')}`;
}
// 役職は1行(常時固定)。詳細(カード・勝利条件・コツ・作戦)は「詳細」で情報シートに出す
function renderBanner() {
  const b = $('roleBanner');
  clear(b);
  if (!S) return;
  if (human == null) {
    b.append(h('b', {}, '👀 観戦'), h('span', { class: 'small dim' }, `配役: ${compText()}`), h('span', { class: 'spacer' }), h('button', { class: 'btn ghost small', title: '盤面(ログの下)へ', onclick: scrollToBoard }, '📋'));
    return;
  }
  const me = S.state.players[human];
  const r = ROLES[me.role];
  const mt = matesText();
  b.append(
    avatar(human, 34), h('span', { class: 'nm' }, plainName(human)), roleTag(me.role), h('span', { class: 'rn' }, r.name),
    ...(mt ? [h('span', { class: 'mates' }, mt)] : []),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn ghost small', title: '役職の詳細', onclick: () => openInfo('role') }, '🃏'),
    h('button', { class: 'btn ghost small', title: '盤面(ログの下)へ', onclick: scrollToBoard }, '📋'),
  );
}
function roleDetailEl(): HTMLElement {
  if (!S || human == null) return h('div', {}, `観戦中。配役: ${compText()}`);
  const me = S.state.players[human];
  const r = ROLES[me.role];
  const card = CARDS[me.role];
  const mt = matesText();
  return h('div', { class: 'roledetail' },
    card ? h('img', { class: 'rolecard', src: card, alt: r.name }) : null,
    h('div', { class: 'body' },
      h('div', {}, avatar(human, 32), ' あなたは ', h('b', {}, plainName(human)), ' ・', roleTag(me.role), h('b', {}, ` ${r.name}`)),
      h('div', { class: 'small' }, r.goal),
      h('div', { class: 'small' }, r.tips),
      mt ? h('div', { class: 'small mates' }, mt) : null,
      me.role === 'werewolf' && planText() ? h('div', { class: 'small mates' }, `📜 作戦: ${planText()}`) : null,
      h('div', { class: 'small dim' }, `この村の配役: ${compText()}`),
    ),
  );
}
// 公開情報から盤面(図メモ)の材料を作る: 生死と原因、CO、判定、投票履歴、名指し回数
interface BoardInfo {
  status: Map<number, { how: 'exec' | 'night'; day: number }>;
  cos: { by: number; claim: string; day: number; results: { target: number; color: Color; day: number }[] }[];
  judged: Map<number, { by: number; color: Color; day: number }[]>; // 人 → 受けた判定
  votes: Map<number, Map<number, number>>; // day → (by → target)
  accused: Map<number, number>;
  days: number;
}
function boardInfo(): BoardInfo {
  const evs = S ? S.state.events.slice(0, shownEv) : [];
  const info: BoardInfo = { status: new Map(), cos: [], judged: new Map(), votes: new Map(), accused: new Map(), days: 0 };
  for (const e of evs) {
    if ('day' in e) info.days = Math.max(info.days, e.day);
    if (e.t === 'execute') info.status.set(e.target, { how: 'exec', day: e.day });
    else if (e.t === 'death') info.status.set(e.target, { how: 'night', day: e.day });
    else if (e.t === 'vote' && e.round === 0) {
      if (!info.votes.has(e.day)) info.votes.set(e.day, new Map());
      info.votes.get(e.day)!.set(e.by, e.target);
    } else if (e.t === 'say') {
      if ((e.st.kind === 'accuse' || e.st.kind === 'agree' || e.st.kind === 'vote_intent' || e.st.kind === 'vote_review' || e.st.kind === 'medium_review' || e.st.kind === 'line' || (e.st.kind === 'propose' && e.st.plan === 'black')) && e.st.target != null) info.accused.set(e.st.target, (info.accused.get(e.st.target) ?? 0) + 1);
      if ((e.st.kind === 'co' || e.st.kind === 'result') && e.st.claim) {
        let c = info.cos.find((x) => x.by === e.by && x.claim === e.st.claim);
        if (!c) info.cos.push((c = { by: e.by, claim: e.st.claim as string, day: e.day, results: [] }));
        if (e.st.target != null && e.st.color && (e.st.claim === 'seer' || e.st.claim === 'medium')) {
          c.results.push({ target: e.st.target, color: e.st.color, day: e.day });
          if (e.st.claim === 'seer') {
            if (!info.judged.has(e.st.target)) info.judged.set(e.st.target, []);
            info.judged.get(e.st.target)!.push({ by: e.by, color: e.st.color, day: e.day });
          }
        }
      }
    }
  }
  return info;
}
const claimMark: Record<string, string> = { seer: '占', medium: '霊', hunter: '狩', mason: '共' };
// 盤面(自動の図メモ): 1人1行。生死・CO・受けた判定・各日の投票先
function boardEl(): HTMLElement {
  if (!S) return h('div');
  const st = S.state;
  const info = boardInfo();
  const reveal = isRevealed();
  const myRole = human != null ? st.players[human].role : null;
  const days = [...info.votes.keys()].sort((a, b) => a - b);
  const table = h('table', { class: 'board' });
  table.append(h('tr', {}, h('th', {}, '参加者'), h('th', {}, 'CO'), h('th', {}, '受けた判定'), ...days.map((d) => h('th', {}, `${d}日目票`))));
  for (const p of st.players) {
    const s = info.status.get(p.id);
    const vis = reveal || p.id === human || (myRole === 'werewolf' && ROLES[p.role].isWolf) || (myRole === 'mason' && p.role === 'mason');
    const co = info.cos.filter((c) => c.by === p.id);
    const jd = info.judged.get(p.id) ?? [];
    table.append(h('tr', { class: s ? 'dead' : '' },
      h('td', { class: 'bp' }, avatar(p.id, 26), ' ', plainName(p.id), vis ? roleTag(p.role) : null, s ? h('span', { class: 'small dim' }, s.how === 'exec' ? ` ⚖${s.day}日` : ` 💀${s.day}日`) : null, p.id === human ? '★' : ''),
      h('td', {}, ...co.map((c) => h('span', { class: 'cob' }, `${claimMark[c.claim] ?? c.claim}CO ${c.day}日`))),
      h('td', {}, ...jd.map((j) => h('span', { class: 'jchip ' + j.color }, `${plainName(j.by)}→${cw(j.color)}`))),
      ...days.map((d) => { const t = info.votes.get(d)?.get(p.id); return h('td', { class: 'small' }, t != null ? plainName(t) : ''); }),
    ));
  }
  const box = h('div', { class: 'boardwrap' }, table);
  // 占い師・霊能者ごとの判定の流れ(ライン)
  const lines = h('div', { class: 'lines' });
  for (const c of info.cos.filter((x) => x.claim === 'seer' || x.claim === 'medium')) {
    lines.append(h('div', { class: 'cor' }, h('b', {}, `${c.claim === 'seer' ? '🔮' : '🕯'} ${plainName(c.by)}（${claimMark[c.claim]}CO ${c.day}日目）`), c.results.length ? h('div', { class: 'small' }, c.results.map((r) => `${r.day}日: ${plainName(r.target)}=${cw(r.color)}`).join(' → ')) : h('div', { class: 'small dim' }, '結果なし')));
  }
  return h('div', {}, box, h('h2', { style: 'margin-top:10px' }, '判定の流れ'), lines, h('div', { class: 'small dim', style: 'margin-top:6px' }, '⚖=処刑 💀=夜の死亡（襲撃か呪殺）。判定は占い師COの発言どおりで、真偽は含みません。'));
}

// ログの絞り込み(2): この人の発言だけ / この人への言及だけ
let feedFilter: { by?: number; about?: number } | null = null;
function setFilter(f: { by?: number; about?: number } | null) {
  feedFilter = f;
  const bar = $('filterBar');
  bar.hidden = !f;
  if (f) $('filterText').textContent = f.by != null ? `🔎 ${plainName(f.by)}の発言だけ表示中` : `🔎 ${plainName(f.about!)}への言及だけ表示中`;
  renderFeedAll();
  stickBottom = true;
  autoScroll();
}
function passFilter(ev: PublicEvent): boolean {
  if (!feedFilter) return true;
  if (ev.t === 'phase') return true;
  if (feedFilter.by != null) return (ev.t === 'say' && ev.by === feedFilter.by) || ((ev.t === 'execute' || ev.t === 'death') && ev.target === feedFilter.by) || (ev.t === 'vote' && ev.by === feedFilter.by);
  const a = feedFilter.about!;
  return (ev.t === 'say' && (ev.st.target === a || ev.st.ref === a)) || ((ev.t === 'execute' || ev.t === 'death') && ev.target === a) || (ev.t === 'vote' && ev.target === a);
}
// 表示済みイベントをログに描き直す(開発者モード切替・絞り込み用)
function renderFeedAll() {
  if (!S) return;
  liveTyping = false;
  const feed = $('feed');
  const keep = shownEv;
  clear(feed);
  ensureBoardSec();
  voteBlock = null;
  morningPicDay = -1;
  shownEv = 0;
  shownNote = 0;
  while (shownEv < keep) {
    if (!feedFilter) for (const nn of allNotesFor(shownEv)) logAppend(h('div', { class: 'note' }, nn.text));
    if (passFilter(S.state.events[shownEv])) appendEvent(S.state.events[shownEv]);
    shownEv++;
  }
  liveTyping = true;
}

// 📋: ログ内の盤面セクションまでスクロール(もう一度押すとログ末尾へ戻る)
function scrollToBoard() {
  const feed = $('feed');
  const b = document.getElementById('boardSec');
  if (!b) return;
  const atBoard = feed.scrollTop >= b.offsetTop - 20;
  progScrollUntil = Date.now() + 700;
  feed.scrollTo({ top: atBoard ? logEndTop() : b.offsetTop, behavior: 'smooth' });
  stickBottom = atBoard;
}
// 情報シート(スマホ用): 役職の詳細 / 盤面 / 参加者の詳細
function openInfo(kind: 'role' | 'co' | 'seat', seat?: number) {
  const body = $('infoBody');
  clear(body);
  if (kind === 'role') {
    $('infoTitle').textContent = '🃏 あなたの役職';
    body.append(roleDetailEl());
  } else if (kind === 'co') {
    $('infoTitle').textContent = '📋 盤面（自動メモ）';
    body.append(boardEl());
  } else {
    $('infoTitle').textContent = '👤 ' + (seat != null ? plainName(seat) : '');
    const row = [...$('seatsList').children].find((el) => (el as HTMLElement).dataset.seat === String(seat));
    if (row) body.append(row.cloneNode(true));
    const info = boardInfo();
    const jd = info.judged.get(seat!) ?? [];
    if (jd.length) body.append(h('div', { class: 'small', style: 'margin-top:6px' }, '受けた判定: ', ...jd.map((j) => h('span', { class: 'jchip ' + j.color }, `${plainName(j.by)}→${cw(j.color)}`))));
    const vs = [...info.votes.entries()].filter(([, m]) => m.has(seat!)).map(([d, m]) => `${d}日: ${plainName(m.get(seat!)!)}`);
    if (vs.length) body.append(h('div', { class: 'small', style: 'margin-top:4px' }, '投票履歴: ' + vs.join(' / ')));
    const pub = [...$('pubinfo').children].filter((el) => (el as HTMLElement).dataset.by === String(seat)).map((el) => el.cloneNode(true));
    if (pub.length) body.append(h('h2', { style: 'margin-top:12px' }, 'この人のCO'), ...pub);
    body.append(h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'btn ghost small', onclick: () => { setFilter({ by: seat! }); $('infoSheet').hidden = true; } }, '🔎 この人の発言だけ'),
      h('button', { class: 'btn ghost small', onclick: () => { setFilter({ about: seat! }); $('infoSheet').hidden = true; } }, '🔎 この人への言及だけ'),
    ));
    body.append(h('div', { class: 'small dim', style: 'margin-top:8px' }, 'バーは名指しされた回数。'));
  }
  $('infoSheet').hidden = false;
}

// ---------------------------------------------------------------- 進行(1イベントずつ表示)
function stopTimer() {
  if (timer != null) clearTimeout(timer);
  timer = null;
}
function scheduleTick(ms?: number) {
  stopTimer();
  timer = window.setTimeout(tick, ms ?? SPEED[sel('speedSel').value] ?? 550);
}

function allNotesFor(idx: number): { text: string }[] {
  if (!S) return [];
  return S.state.notes.filter((n) => n.idx === idx && (human != null ? n.to === human : isRevealed())).map((n) => ({ text: n.text }));
}

// ログの自動スクロール: 新着が来たら常に末尾へ流す(盤面を見ていても戻る)。「新着」の案内は出さない。
// stickBottom は「読者が盤面を見に下へ行った」状態で、新着・自分の行動で true に戻る
let stickBottom = true;
// ログの末尾(盤面セクションの手前)の位置。盤面はログの下にあり、スクロールして見る
function logEndTop(): number {
  const feed = $('feed');
  const b = document.getElementById('boardSec');
  return b ? Math.max(0, b.offsetTop - feed.clientHeight) : feed.scrollHeight - feed.clientHeight;
}
// ログに追加(常に盤面セクションの手前に入れる)
function logAppend(...nodes: (Node | string)[]) {
  const feed = $('feed');
  const b = document.getElementById('boardSec');
  for (const nd of nodes) {
    if (b) feed.insertBefore(typeof nd === 'string' ? document.createTextNode(nd) : nd, b);
    else feed.append(nd);
  }
}
// 盤面セクション(ログの下に常設)を作り直す
function ensureBoardSec() {
  const feed = $('feed');
  let b = document.getElementById('boardSec');
  if (!b) {
    b = h('div', { class: 'boardsec', id: 'boardSec' });
    feed.append(b);
  }
  clear(b);
  b.append(h('div', { class: 'boardT' }, '📋 盤面（自動メモ）', h('span', { class: 'small dim' }, '　ログの下に常設。📋ボタンでここへ')), S ? boardEl() : h('div', { class: 'dim small' }, 'ゲーム開始後に表示されます'));
}
// 新着が来たときは一気に飛ばさず、滑らかに流す(読んでいる行が急に上へ消えないように)。
// 滑らかスクロール中に発生する scroll イベントは「読者が上に戻った」と誤認しないよう無視する
let progScrollUntil = 0;
function autoScroll() {
  const feed = $('feed');
  stickBottom = true;
  const top = logEndTop();
  if (Math.abs(feed.scrollTop - top) > 1) {
    // 最速再生のときは滑らかにすると追いつかないので即時
    const smooth = sel('speedSel').value !== 'max';
    progScrollUntil = Date.now() + (smooth ? 700 : 50);
    feed.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  }
}
function tick() {
  timer = null;
  if (!S || paused) return;
  const evs = S.state.events;
  if (shownEv < evs.length) {
    if (!feedFilter) for (const n of allNotesFor(shownEv)) logAppend(h('div', { class: 'note' }, n.text));
    if (passFilter(evs[shownEv])) appendEvent(evs[shownEv]);
    shownEv++;
    renderSide();
    autoScroll();
    const fast = evs[shownEv - 1].t === 'vote';
    // 発言はタイピングが終わってから次へ(読む間を少し足す)
    const wait = fast ? Math.min(60, SPEED[sel('speedSel').value] ?? 60) : lastTypeMs > 0 ? lastTypeMs + Math.round((SPEED[sel('speedSel').value] ?? 550) * 0.6) : undefined;
    lastTypeMs = 0;
    scheduleTick(wait);
    return;
  }
  if (S.pending) {
    showAction();
      return;
  }
  if (S.finished) {
    for (const n of allNotesFor(evs.length)) logAppend(h('div', { class: 'note' }, n.text));
    if (S.error) logAppend(h('div', { class: 'ev err' }, `⚠ 異常が発生しました: ${S.error}`));
    autoScroll();
    showEnd();
    renderSide();
    }
}

// 発言のタイピング表示: 1文字ずつ出す(速度設定に連動。最速・自分の発言・再描画時は一括)。
// 戻り値のspanに文字を流し込み、かかる時間を lastTypeMs に記録して次のイベントを待たせる
const TYPE_MS: Record<string, number> = { slow: 45, mid: 28, fast: 12, max: 0 };
let lastTypeMs = 0;
let typingTimer: number | null = null;
function typeText(text: string, instant: boolean): HTMLElement {
  const span = h('span', { class: 'typed' });
  const per = TYPE_MS[sel('speedSel').value] ?? 0;
  if (instant || per === 0 || !liveTyping) {
    span.textContent = text;
    lastTypeMs = 0;
    return span;
  }
  const chars = [...text];
  // 長文でも待ちすぎないように上限2.2秒、その分1文字あたりを縮める
  const step = Math.min(per, 2200 / Math.max(1, chars.length));
  lastTypeMs = Math.round(step * chars.length);
  let i = 0;
  if (typingTimer != null) window.clearInterval(typingTimer);
  span.classList.add('typing');
  typingTimer = window.setInterval(() => {
    i++;
    span.textContent = chars.slice(0, i).join('');
    if (stickBottom) { const feed = $('feed'); feed.scrollTop = logEndTop(); }
    if (i >= chars.length) {
      if (typingTimer != null) window.clearInterval(typingTimer);
      typingTimer = null;
      span.classList.remove('typing');
    }
  }, step);
  return span;
}
let liveTyping = true; // renderFeedAll(再描画)中は false にして一括表示

// 場面に合わせて背景イラストを切り替える(画像が無ければ単色のまま)
function setBg(key: 'day' | 'vote' | 'night' | 'night0') {
  const el = document.getElementById('bg');
  if (!el) return;
  const url = BGS[key];
  el.style.backgroundImage = url ? `url(${url})` : '';
  el.classList.toggle('on', !!url);
}

// 出来事の挿絵(画像が無ければ何も出さない)。朝の最初の出来事・処刑・勝敗に1枚
function picEl(key: string, cls = 'evpic'): HTMLElement | null {
  const url = EVENTS[key];
  return url ? h('div', { class: cls, style: `background-image:url(${url})` }) : null;
}
// その朝の挿絵は1枚だけ(死者が2人の朝=呪殺の形跡は「呪殺」の絵)
let morningPicDay = -1;
function morningPic(day: number, key: string) {
  if (morningPicDay === day) return;
  morningPicDay = day;
  const p = picEl(key);
  if (p) logAppend(p);
}

// 人間が死亡したとき: 以降は観戦になることを知らせる(ゲームは最後まで進む。死後は役職が公開される)
function humanDied(how: string) {
  const feed = $('feed');
  logAppend(h('div', { class: 'ev note' }, `🪦 あなたは${how}。ここからは観戦です。村の行方を最後まで見届けましょう（終了後に全員の役職が公開されます）。`));
  toast(`あなたは${how}。以降は観戦になります`);
  showStatus('🪦 観戦中（⏩で最速）');
}

function appendEvent(ev: PublicEvent) {
  const feed = $('feed');
  const st = S!.state;
  const nm = (i: number) => st.players[i].name;
  switch (ev.t) {
    case 'phase': {
      voteBlock = null;
      const label =
        ev.phase === 'day' ? `☀ ${ev.day}日目 — 昼の話し合い`
        : ev.phase === 'vote' ? `🗳 ${ev.day}日目 — 投票`
        : ev.phase === 'night' ? (ev.day === 0 ? '🌙 初夜（占い師が占い、人狼が作戦会議）' : `🌙 ${ev.day}日目の夜`)
        : `🌅 ${ev.day}日目の朝`;
      logAppend(h('div', { class: 'phase' }, label));
      $('phaseNow').textContent = label;
      document.querySelector('.app')?.classList.toggle('night', ev.phase === 'night');
      setBg(ev.phase === 'night' ? (ev.day === 0 ? 'night0' : 'night') : ev.phase === 'vote' ? 'vote' : 'day');
      break;
    }
    case 'say': {
      const isCo = ev.st.kind === 'co' || ev.st.kind === 'result';
      const isPlan = ev.st.kind === 'propose';
      logAppend(
        h('div', { class: 'say' + (ev.by === human ? ' me' : ''), onclick: () => pickTarget(ev.by) },
          h('div', { class: 'who' }, avatar(ev.by, 46), h('span', { class: 'who-t' }, plainName(ev.by), isRevealed() ? roleTag(st.players[ev.by].role) : null)),
          // 役職の発言(CO・結果・護衛)は役職バッジと同じ色で(占=青、霊=紫、狩=緑、共=深緑)
          h('div', { class: 'bubble' + (isCo ? ` co ${ev.st.claim}` : '') }, isCo ? h('span', { class: `cotag ${ev.st.claim}` }, ev.st.kind === 'co' ? 'CO' : ev.st.claim === 'hunter' ? '護衛' : '結果') : isPlan ? h('span', { class: 'cotag plan' }, '提案') : null, typeText(ev.text, ev.by === human)),
        ),
      );
      break;
    }
    case 'vote': {
      const key = `${ev.day}-${ev.round}`;
      if (!voteBlock || voteBlock.key !== key) {
        const el = h('div', { class: 'votes' }, h('div', { class: 'votesT' }, ev.round === 0 ? '投票結果' : '決選投票'));
        logAppend(el);
        voteBlock = { key, el };
      }
      voteBlock.el.append(h('span', { class: 'chip' }, `${nm(ev.by)} → ${nm(ev.target)}`));
      // 得票の集計(多い順)を先頭に出す。票が入るたびに更新
      const tally = new Map<number, number>();
      for (const e of st.events.slice(0, shownEv + 1)) if (e.t === 'vote' && e.day === ev.day && e.round === ev.round) tally.set(e.target, (tally.get(e.target) ?? 0) + 1);
      let tl = voteBlock.el.querySelector('.tally') as HTMLElement | null;
      if (!tl) { tl = h('div', { class: 'tally' }); voteBlock.el.insertBefore(tl, voteBlock.el.children[1] ?? null); }
      clear(tl);
      for (const [t, c] of [...tally.entries()].sort((a, b) => b[1] - a[1])) tl.append(h('span', { class: 'tchip' + (c === Math.max(...tally.values()) ? ' top' : '') }, avatar(t, 20), `${plainName(t)} ${c}票`));
      break;
    }
    case 'execute':
      { const p = picEl('execution'); if (p) logAppend(p); }
      logAppend(h('div', { class: 'ev exec' }, `⚖ ${nm(ev.target)} が処刑されました（${ev.votes}票）`, isRevealed() ? roleTag(st.players[ev.target].role) : null));
      if (ev.target === human) humanDied('処刑されました');
      break;
    case 'death':
      morningPic(ev.day, st.events.filter((e) => e.t === 'death' && e.day === ev.day).length >= 2 ? 'curse' : 'morning_death');
      logAppend(h('div', { class: 'ev death' }, `💀 ${nm(ev.target)} が人狼に襲撃されました`, isRevealed() ? roleTag(st.players[ev.target].role) : null));
      if (ev.target === human) humanDied('人狼に襲撃されました');
      break;
    case 'peace':
      morningPic(ev.day, 'morning_peace');
      logAppend(h('div', { class: 'ev peace' }, '🌅 昨夜は誰も襲撃されませんでした（平和な朝）'));
      break;
    case 'end':
      { const p = ev.winner === 'village' || ev.winner === 'wolf' || ev.winner === 'fox' ? picEl(`win_${ev.winner}`) : null; if (p) logAppend(p); }
      logAppend(h('div', { class: 'ev win' }, ev.winner === 'village' ? '🏁 村人陣営の勝利！' : ev.winner === 'wolf' ? '🏁 人狼陣営の勝利！' : ev.winner === 'fox' ? '🏁 妖狐の勝利！' : '🏁 決着がつきませんでした'));
      break;
  }
}

function isRevealed(): boolean {
  return !!S && (S.finished && shownEv >= S.state.events.length || inp('devChk').checked);
}

// ---------------------------------------------------------------- サイドパネル
function renderSide() {
  if (!S) return;
  const st = S.state;
  const evs = st.events.slice(0, shownEv);
  const dead = new Set<number>();
  const accused = new Map<number, number>();
  const cos: { by: number; claim: string; results: { target: number; color: Color }[] }[] = [];
  for (const e of evs) {
    if (e.t === 'execute' || e.t === 'death') dead.add(e.target);
    if (e.t === 'say') {
      if ((e.st.kind === 'accuse' || e.st.kind === 'agree' || e.st.kind === 'vote_intent' || e.st.kind === 'vote_review' || e.st.kind === 'medium_review' || e.st.kind === 'line' || (e.st.kind === 'propose' && e.st.plan === 'black')) && e.st.target != null) accused.set(e.st.target, (accused.get(e.st.target) ?? 0) + 1);
      if ((e.st.kind === 'co' || e.st.kind === 'result') && e.st.claim) {
        let c = cos.find((x) => x.by === e.by && x.claim === e.st.claim);
        if (!c) cos.push((c = { by: e.by, claim: e.st.claim as string, results: [] }));
        if (e.st.target != null && e.st.color) c.results.push({ target: e.st.target, color: e.st.color });
      }
    }
  }
  const reveal = isRevealed();
  const seats = $('seatsList');
  clear(seats);
  const strip = $('seats');
  clear(strip);
  const myRole = human != null ? st.players[human].role : null;
  for (const p of st.players) {
    const vis = reveal || p.id === human || (myRole === 'werewolf' && ROLES[p.role].isWolf) || (myRole === 'mason' && p.role === 'mason');
    const coBadges = cos.filter((c) => c.by === p.id).map((c) => h('span', { class: 'cob' }, c.claim === 'seer' ? '占CO' : c.claim === 'medium' ? '霊CO' : c.claim === 'mason' ? '共CO' : '狩CO'));
    const cnt = accused.get(p.id) ?? 0;
    // 丸アイコン一列(常時固定): 死亡はグレー、CO印、名指しされていると点、タップで詳細
    const myCo = cos.find((c) => c.by === p.id);
    strip.append(
      h('button', { class: 'sb' + (dead.has(p.id) ? ' dead' : '') + (p.id === human ? ' me' : ''), type: 'button', title: plainName(p.id), onclick: () => (pickTarget(p.id) ? undefined : openInfo('seat', p.id)) },
        avatar(p.id, 38),
        h('span', { class: 'sbn' }, plainName(p.id)),
        myCo ? h('span', { class: 'mk ' + myCo.claim }, myCo.claim === 'seer' ? '占' : myCo.claim === 'medium' ? '霊' : myCo.claim === 'mason' ? '共' : '狩') : null,
        vis && (reveal || p.id !== human) && ROLES[p.role].isWolf ? h('span', { class: 'mk', style: 'background:var(--wolf);top:auto;bottom:16px;left:2px;right:auto' }, '狼') : null,
        // 疑いバー: 名指しされた回数(最大7回で満タン)
        h('span', { class: 'sbh', title: `名指し ${cnt}回` }, h('i', { style: `width:${Math.min(100, cnt * 14)}%` })),
      ),
    );
    seats.append(
      h('div', { class: 'seat' + (dead.has(p.id) ? ' dead' : '') + (p.id === human ? ' me' : ''), 'data-seat': String(p.id) },
        avatar(p.id, 38),
        h('span', { class: 'nm' }, (dead.has(p.id) ? '💀 ' : '') + plainName(p.id) + (p.id === human ? '（あなた）' : '')),
        vis ? roleTag(p.role) : null,
        ...coBadges,
        reveal ? h('span', { class: 'pers' }, st.personalities[p.id].name) : null,
        h('span', { class: 'heat', title: `名指しされた回数 ${cnt}` }, h('i', { style: `width:${Math.min(100, cnt * 14)}%` })),
      ),
    );
  }
  const pub = $('pubinfo');
  clear(pub);
  if (!cos.length) pub.append(h('div', { class: 'dim' }, 'まだCOはありません'));
  for (const c of cos) {
    const lab = c.claim === 'seer' ? '🔮 占い師' : c.claim === 'medium' ? '🕯 霊能者' : c.claim === 'mason' ? '👥 共有者' : '🛡 狩人';
    pub.append(h('div', { class: 'cor', 'data-by': String(c.by) }, h('b', {}, `${lab}CO: ${st.players[c.by].name}`), c.results.length ? h('div', { class: 'small' }, c.results.map((r) => `${st.players[r.target].name}=${cw(r.color)}`).join(' / ')) : null));
  }
  const aliveN = st.players.length - dead.size;
  $('aliveInfo').textContent = `生存 ${aliveN}/${st.players.length}`;
  ensureBoardSec();
}


// ---------------------------------------------------------------- 人間の入力
function aliveOthers(req: HumanRequest): { id: number; name: string }[] {
  return req.obs.players.filter((p) => p.alive && p.id !== req.playerId);
}
// 画面内の短い通知(alert はArtifactの環境では表示されないので使わない)
function toast(msg: string) {
  const el = h('div', { class: 'toast' }, msg);
  document.body.append(el);
  window.setTimeout(() => el.remove(), 2200);
}
const SELECT_LABELS: Record<string, string> = { actTarget: '相手（発言・投票・夜の行動の対象）', fakeTarget: '偽の占い結果を出す相手', fakeMedTarget: '偽の霊能結果を出す相手', fakeGuard: '偽の護衛報告で守ったと言う相手', lineRef: 'ライン指摘のもう一人' };
function targetSelect(list: { id: number; name: string }[], id = 'actTarget'): HTMLSelectElement {
  const s = h('select', { id, class: 'sel', 'aria-label': SELECT_LABELS[id] ?? '相手' }) as HTMLSelectElement;
  for (const p of list) s.append(h('option', { value: String(p.id) }, p.name));
  return s;
}
function respond(r: HumanResponse) {
  if (!S) return;
  showStatus('⏳ AIが考えています…');
  S.respond(r);
  autoScroll(); // 行動したら(盤面を見ていても)ログ末尾へ戻り、自分の発言と皆の反応を追う
  if (typeof r === 'object' && r !== null && 'fakeSeer' in r) renderBanner(); // 作戦会議の結果をバナーに反映
  scheduleTick(0);
}

function showAction() {
  if (!S?.pending) return;
  const req = S.pending;
  const box = $('action');
  clear(box);
  const card = h('div', { class: 'actcard' });
  box.append(card);
  if (req.type === 'talk') talkUI(card, req);
  else if (req.type === 'plan') planUI(card, req);
  else if (req.type === 'vote') {
    const s = targetSelect(req.candidates.map((i) => ({ id: i, name: req.obs.players[i].name })));
    card.append(h('div', { class: 'actT' }, '🗳 あなたの投票'), h('div', { class: 'row' }, s, h('button', { class: 'btn', onclick: () => respond(Number(s.value)) }, 'この人に投票する')));
  } else {
    const verb = req.kind === 'divine' ? '🔮 誰を占う？' : req.kind === 'guard' ? '🛡 誰を護衛する？' : '🐺 今夜、誰を襲撃する？';
    { const url = NIGHTS[req.kind]; if (url) card.append(h('div', { class: 'nightpic', style: `background-image:url(${url})` })); }
    // 役職COしている人には印をつける(占い先はグレーから選ぶのがセオリー)
    const claimed = new Map<number, string>();
    for (const e of req.obs.events) if (e.t === 'say' && (e.st.kind === 'co' || e.st.kind === 'result') && e.st.claim) claimed.set(e.by, { seer: '占', medium: '霊', hunter: '狩', mason: '共' }[e.st.claim as string] ?? '');
    const s = targetSelect(req.candidates.map((i) => ({ id: i, name: req.obs.players[i].name + (claimed.has(i) ? `（${claimed.get(i)}CO）` : '') })));
    card.append(h('div', { class: 'actT' }, verb), h('div', { class: 'row' }, s, h('button', { class: 'btn', onclick: () => respond(Number(s.value)) }, '決定')));
    if (req.kind === 'divine' && claimed.size) card.append(h('div', { class: 'small' }, '💡 占い先はグレー（役職COしていない人）から選ぶのがセオリー。霊能・狩人COや対抗占いを占っても、村の判断はあまり変わりません。'));
  }
}
// 自分の番なら、タップした人を「相手」(投票先・占い先など)にする(セレクトを開かずに済む)。指定できたら true
function pickTarget(id: number): boolean {
  const s = document.getElementById('actTarget') as HTMLSelectElement | null;
  if (!s || !S?.pending || S.pending.type === 'plan') return false; // 発言・投票・夜行動のどれでも「相手」を指定できる
  if (![...s.options].some((o) => o.value === String(id))) return false;
  s.value = String(id);
  s.classList.add('flash');
  window.setTimeout(() => s.classList.remove('flash'), 600);
  toast(`相手: ${plainName(id)}`);
  return true;
}
// 自分の番でないときのフッター(1行)
function showStatus(text: string) {
  const box = $('action');
  clear(box);
  box.append(h('div', { class: 'statusline' }, text));
}

// 人狼の作戦会議(人間が人狼のとき、初夜に1回)
function planUI(card: HTMLElement, req: Extract<HumanRequest, { type: 'plan' }>) {
  const me = req.playerId;
  const fakeSel = h('select', { class: 'sel' }, h('option', { value: '' }, '騙らない'), h('option', { value: String(me) }, `自分（${plainName(me)}）が占い師を騙る`), ...req.mates.map((m) => h('option', { value: String(m) }, `${plainName(m)}が占い師を騙る`))) as HTMLSelectElement;
  const kakoi = h('input', { type: 'checkbox', checked: 'checked' }) as HTMLInputElement;
  kakoi.checked = true; // 統計上、囲いありが人狼側の最善(docs/DESIGN.md 12章)
  const cut = h('input', { type: 'checkbox', checked: 'checked' }) as HTMLInputElement;
  cut.checked = true;
  card.append(
    ...(NIGHTS.council ? [h('div', { class: 'nightpic', style: `background-image:url(${NIGHTS.council})` })] : []),
    h('div', { class: 'actT' }, '🐺 作戦会議（人狼だけの相談）'),
    h('div', { class: 'small' }, `仲間: ${req.mates.map((m) => plainName(m)).join('、') || 'なし'}`),
    h('div', { class: 'row wrap' }, h('span', { class: 'lbl' }, '占い騙り:'), fakeSel),
    h('label', { class: 'row' }, kakoi, ' 囲い（偽占いで仲間に白を出し、仲間を白く見せる。露呈すると二人まとめて疑われるが、統計上は囲いありが有利）'),
    h('label', { class: 'row' }, cut, ' 身内切り（仲間が吊られそうなときは自分も投票して村人のふりをする）'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => respond({ fakeSeer: fakeSel.value === '' ? null : Number(fakeSel.value), kakoi: kakoi.checked, cut: cut.checked }) }, '決定')),
  );
}

function talkUI(card: HTMLElement, req: Extract<HumanRequest, { type: 'talk' }>) {
  const obs = req.obs;
  const others = aliveOthers(req);
  const s = targetSelect(others);
  const send = (st: Statement) => respond(st);
  const tgt = () => Number(s.value);
  const role = obs.self.role;
  const mySays = obs.events.filter((e): e is Extract<PublicEvent, { t: 'say' }> => e.t === 'say' && e.by === obs.self.id);
  const coDone = (claim: string) => mySays.some((e) => e.st.kind === 'co' && e.st.claim === claim);
  const reported = (claim: string, target: number) => mySays.some((e) => (e.st.kind === 'co' || e.st.kind === 'result') && e.st.claim === claim && e.st.target === target);

  card.append(h('div', { class: 'actT' }, `💬 あなたの発言（${obs.day}日目 ${obs.round + 1}/${obs.config.rounds}）`));
  card.append(
    h('div', { class: 'row' }, h('span', { class: 'lbl' }, '相手:'), s),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: () => send({ kind: 'accuse', target: tgt() }) }, '🗣 疑う'),
      h('button', { class: 'btn ghost', onclick: () => send({ kind: 'defend', target: tgt() }) }, '🛡 かばう'),
      obs.day > 1 || obs.config.day1Vote ? h('button', { class: 'btn ghost', onclick: () => send({ kind: 'vote_intent', target: tgt() }) }, '🗳 投票宣言') : null,
      h('button', { class: 'btn ghost', onclick: () => send({ kind: 'wait' }) }, '😶 様子見'),
      // 占い師COを促すのは、まだ誰も占い師COしていないときだけ
      !obs.events.some((e) => e.t === 'say' && (e.st.kind === 'co' || e.st.kind === 'result') && e.st.claim === 'seer') ? h('button', { class: 'btn ghost', onclick: () => send({ kind: 'ask_co' }) }, '📣 占い師はCOして') : null,
    ),
  );
  // 役職ごとの特別な発言
  const extra = h('div', { class: 'row wrap extra' });
  const addBtn = (label: string, st: Statement) => extra.append(h('button', { class: 'btn role', onclick: () => send(st) }, label));
  if (role === 'seer') {
    const res = obs.priv.seerResults ?? [];
    const last = res[res.length - 1];
    if (last && !reported('seer', last.target)) addBtn(`🔮 ${coDone('seer') ? '占い結果を報告' : '占い師CO'}（${obs.players[last.target].name}＝${cw(last.color)}）`, { kind: coDone('seer') ? 'result' : 'co', claim: 'seer', target: last.target, color: last.color });
  } else if (role === 'medium') {
    const res = obs.priv.mediumResults ?? [];
    const last = res[res.length - 1];
    if (last && !reported('medium', last.target)) addBtn(`🕯 ${coDone('medium') ? '霊能結果を報告' : '霊能者CO'}（${obs.players[last.target].name}＝${cw(last.color)}）`, { kind: coDone('medium') ? 'result' : 'co', claim: 'medium', target: last.target, color: last.color });
    else if (!last && !coDone('medium')) addBtn('🕯 霊能者CO（結果はまだなし）', { kind: 'co', claim: 'medium' });
  } else if (role === 'hunter') {
    const last = (obs.priv.guardLog ?? []).slice(-1)[0];
    const peaceToday = obs.events.some((e) => e.t === 'peace' && e.day === obs.day);
    const gjDone = mySays.some((e) => e.day === obs.day && e.st.kind === 'result' && e.st.claim === 'hunter'); // 平和な朝ごとに報告できる
    if (last && last.day === obs.day - 1 && peaceToday && !gjDone && obs.players[last.target].alive) addBtn(`🛡 護衛成功を報告（${obs.players[last.target].name}を守った）`, { kind: 'result', claim: 'hunter', target: last.target });
    if (!coDone('hunter')) addBtn('🛡 狩人CO（ピンチのときだけ）', { kind: 'co', claim: 'hunter' });
  } else if (role === 'mason') {
    if (!coDone('mason')) addBtn('👥 共有者CO', { kind: 'co', claim: 'mason' });
  } else if (role === 'werewolf' || role === 'madman') {
    const s2 = targetSelect(others, 'fakeTarget');
    const col = h('select', { id: 'fakeColor', class: 'sel', 'aria-label': '偽の占い結果の色' }, h('option', { value: 'white' }, '白'), h('option', { value: 'black' }, '黒')) as HTMLSelectElement;
    extra.append(
      h('span', { class: 'lbl' }, '占い師を騙る:'), s2, col,
      h('button', { class: 'btn role', onclick: () => send({ kind: coDone('seer') ? 'result' : 'co', claim: 'seer', target: Number(s2.value), color: col.value as Color }) }, coDone('seer') ? '偽の結果を報告' : '占い師COする(偽)'),
    );
    // 狩人を騙る(吊り逃れ。翌日噛まれていないと疑われる)
    if (!coDone('hunter') && !coDone('seer') && !coDone('medium')) addBtn('🛡 狩人COする(偽・吊り逃れ)', { kind: 'co', claim: 'hunter' });
    // 狩人を騙っているとき、平和な朝なら偽の護衛報告もできる(死者が出た朝に言うと矛盾で偽物と見られる)
    if (coDone('hunter') && obs.events.some((e) => e.t === 'peace' && e.day === obs.day) && !mySays.some((e) => e.day === obs.day && e.st.kind === 'result' && e.st.claim === 'hunter')) {
      const s4 = targetSelect(others, 'fakeGuard');
      extra.append(h('span', { class: 'lbl' }, '護衛成功を報告(偽):'), s4, h('button', { class: 'btn role', onclick: () => send({ kind: 'result', claim: 'hunter', target: Number(s4.value) }) }, '守ったと言う'));
    }
    // 霊能者を騙る(処刑者がいるときだけ)
    const executed = obs.events.filter((e): e is Extract<PublicEvent, { t: 'execute' }> => e.t === 'execute').map((e) => e.target);
    if (executed.length && !coDone('seer')) {
      const s3 = h('select', { id: 'fakeMedTarget', class: 'sel' }, ...executed.map((t) => h('option', { value: String(t) }, obs.players[t].name))) as HTMLSelectElement;
      const col3 = h('select', { id: 'fakeMedColor', class: 'sel' }, h('option', { value: 'white' }, '白'), h('option', { value: 'black' }, '黒')) as HTMLSelectElement;
      extra.append(
        h('span', { class: 'lbl' }, '霊能者を騙る:'), s3, col3,
        h('button', { class: 'btn role', onclick: () => send({ kind: coDone('medium') ? 'result' : 'co', claim: 'medium', target: Number(s3.value), color: col3.value as Color }) }, coDone('medium') ? '偽の霊能結果を報告' : '霊能者COする(偽)'),
      );
    }
  }
  if (extra.childNodes.length) card.append(h('div', { class: 'lbl role-label' }, 'あなたの役職の発言:'), extra);

  // ---- 進行の提案・考察(状況に合うものだけ出す) ----
  const ctxRow = h('div', { class: 'row wrap extra' });
  const addCtx = (label: string, st: Statement, title = '') => ctxRow.append(h('button', { class: 'btn ghost', title, onclick: () => send(st) }, label));
  const says = obs.events.filter((e): e is Extract<PublicEvent, { t: 'say' }> => e.t === 'say');
  // 会話の取っ掛かり: 指名して聞く / 沈黙の指摘 / COの速さ
  ctxRow.append(h('button', { class: 'btn ghost', title: '「相手」に意見を求めます（相手は次の発言で様子見しにくくなります）', onclick: () => send({ kind: 'ask', target: tgt() }) }, '❓ 「相手」に意見を聞く'));
  // 反論: 今日自分を疑った人に言い返す / 反対: 「相手」への直近の疑いは違う、と異を唱える
  {
    const todays = says.filter((e) => e.day === obs.day && e.st.target != null && ['accuse', 'vote_intent', 'agree', 'silent_point', 'waver', 'vote_review', 'medium_review'].includes(e.st.kind));
    const accuser = [...todays].reverse().find((e) => e.st.target === obs.self.id && e.by !== obs.self.id && obs.players[e.by].alive);
    if (accuser) {
      const myWhite = mySays.some((e) => (e.st.kind === 'co' || e.st.kind === 'result') && e.st.claim === 'seer' && e.st.color === 'white');
      const myVoted = obs.events.some((e) => e.t === 'vote' && e.by === obs.self.id && e.day === obs.day - 1);
      addCtx(`🙅 ${obs.players[accuser.by].name}に反論する`, { kind: 'defend_self', target: accuser.by, tag: myWhite ? 'white' : myVoted ? 'vote_hist' : 'ask_back' }, '自分を疑った人に言い返します（根拠を聞き返す／自分の票を説明／自分の判定を根拠に）');
    }
    const t0 = tgt();
    const acc = [...todays].reverse().find((e) => e.st.target === t0 && e.by !== obs.self.id && obs.players[e.by].alive);
    if (acc) addCtx(`✋ ${obs.players[acc.by].name}の「相手」への疑いに反対`, { kind: 'disagree', target: t0, ref: acc.by }, '直近の疑いは違う、と異を唱えます');
  }
  ctxRow.append(h('button', { class: 'btn ghost', title: '今日まだ発言していない「相手」の沈黙を指摘します', onclick: () => {
    const t = tgt();
    if (says.some((e) => e.day === obs.day && e.by === t && e.st.kind !== 'wait')) return void toast('その人は今日すでに発言しています');
    send({ kind: 'silent_point', target: t });
  } }, '🤐 「相手」の沈黙を指摘'));
  if (obs.day <= 2) {
    const order = [...new Set(says.filter((e) => e.st.claim === 'seer' && (e.st.kind === 'co' || e.st.kind === 'result')).map((e) => e.by))].filter((c) => obs.players[c].alive && c !== obs.self.id);
    if (order.length >= 2) {
      addCtx(`⚡ ${obs.players[order[0]].name}のCOは早い（真っぽい）`, { kind: 'co_timing', target: order[0], tag: 'early' });
      for (const c of order.slice(1)) addCtx(`🐢 ${obs.players[c].name}のCOは後出し`, { kind: 'co_timing', target: c, tag: 'late' });
    }
  }
  const aliveSet = new Set(others.map((o) => o.id));
  const claimants = (claim: string) => [...new Set(says.filter((e) => (e.st.kind === 'co' || e.st.kind === 'result') && e.st.claim === claim).map((e) => e.by))].filter((p) => aliveSet.has(p));
  const seerCos = claimants('seer');
  const canVote = obs.day > 1 || obs.config.day1Vote;
  if (canVote) {
    // 黒先を吊ろう: 占い師COが黒を出した生存者
    const blacks = [...new Set(says.filter((e) => e.st.claim === 'seer' && e.st.color === 'black' && e.st.target != null).map((e) => e.st.target as number))].filter((p) => aliveSet.has(p));
    for (const t of blacks) addCtx(`⚫ 黒先の${obs.players[t].name}を吊ろう`, { kind: 'propose', plan: 'black', target: t });
    if (seerCos.length >= 2) {
      addCtx('🔁 占い師ローラーを提案', { kind: 'propose', plan: 'roller' }, '占い師COを順番に吊って確かめる');
      addCtx('🌫 グレー吊りを提案', { kind: 'propose', plan: 'grey' }, '占い師は吊らず、役職COしていない人から吊る');
    }
    if (claimants('medium').length >= 2) addCtx('🔁 霊能ローラーを提案', { kind: 'propose', plan: 'medium_roller' });
  }
  if (obs.day >= 2) {
    // 昨日の投票への言及(相手セレクトの人が昨日入れた先を自動で添える)
    const yv = new Map<number, number>();
    for (const e of obs.events) if (e.t === 'vote' && e.day === obs.day - 1 && e.round === 0) yv.set(e.by, e.target);
    ctxRow.append(h('button', { class: 'btn ghost', title: '「相手」が昨日入れた票先について言及します', onclick: () => {
      const t = tgt();
      const ref = yv.get(t);
      if (ref == null) return void toast('その人は昨日投票していません');
      send({ kind: 'vote_review', target: t, ref });
    } }, '🗂 「相手」の昨日の票を指摘'));
    const deadToday = obs.events.filter((e): e is Extract<PublicEvent, { t: 'death' }> => e.t === 'death' && e.day === obs.day).map((e) => e.target);
    for (const d of deadToday) addCtx(`🌙 ${obs.players[d].name}が噛まれた理由を考察`, { kind: 'attack_review', target: d });
    if (says.some((e) => e.st.claim === 'medium' && e.st.color === 'black')) ctxRow.append(h('button', { class: 'btn ghost', title: '黒だった人に投票していなかった、など', onclick: () => send({ kind: 'medium_review', target: tgt() }) }, '🕯 霊能結果から「相手」を指摘'));
    // ブレの指摘: 「相手」が昨日投票した先と、今日の発言の矛先が違うとき
    ctxRow.append(h('button', { class: 'btn ghost', title: '「相手」の昨日の票先と今日の疑い先が違うことを指摘します', onclick: () => {
      const t = tgt();
      const y = yv.get(t);
      const todaySt = [...says].reverse().find((e) => e.day === obs.day && e.by === t && (e.st.kind === 'accuse' || e.st.kind === 'vote_intent' || e.st.kind === 'agree') && e.st.target != null);
      if (y == null || !todaySt || todaySt.st.target === y || !aliveSet.has(y)) return void toast('その人は昨日と今日で疑い先が変わっていません');
      send({ kind: 'waver', target: t, ref: y });
    } }, '🔀 「相手」のブレを指摘'));
    // 噛み筋: 今朝噛まれた人が昨日疑っていた人 / かばっていた人
    for (const d of deadToday) {
      const y = yv.get(d);
      if (y != null && aliveSet.has(y)) addCtx(`🐺 噛まれた${obs.players[d].name}が疑っていた${obs.players[y].name}は黒寄り`, { kind: 'bite_logic', target: y, ref: d, color: 'black' });
      const dfd = says.find((e) => e.day === obs.day - 1 && e.by === d && e.st.kind === 'defend' && e.st.target != null && aliveSet.has(e.st.target));
      if (dfd?.st.target != null) addCtx(`🕊 噛まれた${obs.players[d].name}がかばっていた${obs.players[dfd.st.target].name}は白寄り`, { kind: 'bite_logic', target: dfd.st.target, ref: d, color: 'white' });
    }
    // 確定の宣言: 占い師COが噛まれていれば、残りの占い師COは偽物
    const atkSeer = says.filter((e) => e.st.claim === 'seer').map((e) => e.by).find((c) => obs.events.some((e) => e.t === 'death' && e.target === c));
    if (atkSeer != null) for (const c of seerCos) addCtx(`✅ ${obs.players[c].name}はまず偽物と宣言`, { kind: 'confirm', target: c, ref: atkSeer });
    // 人数カウント
    const aliveN = obs.players.filter((p) => p.alive).length;
    const wolvesTotal = obs.config.roleCounts.werewolf;
    const knownWolvesDead = says.filter((e) => e.st.kind === 'result' && e.st.claim === 'medium' && e.st.color === 'black').length;
    addCtx(`🔢 人数カウント（残り${aliveN}人・人狼最大${Math.max(1, wolvesTotal - knownWolvesDead)}）`, { kind: 'count', n: aliveN, m: Math.max(1, wolvesTotal - knownWolvesDead) });
    // ライン指摘: 「相手」ともう1人
    const s4 = targetSelect(others, 'lineRef');
    ctxRow.append(h('span', { class: 'lbl' }, 'ライン:'), s4, h('button', { class: 'btn ghost', onclick: () => { const a = tgt(), b2 = Number(s4.value); if (a === b2) return void toast('別の2人を選んでください'); send({ kind: 'line', target: a, ref: b2 }); } }, '🔗 「相手」とこの人のラインを指摘'));
  }
  // 提案・考察は数が多いので折りたたみ(必要なときだけ開く)
  if (ctxRow.childNodes.length) {
    const nBtn = ctxRow.querySelectorAll('button').length;
    card.append(h('details', { class: 'more' }, h('summary', {}, h('span', { class: 'caret' }, '▸'), '進行の提案・考察', h('span', { class: 'cnt' }, `${nBtn}種`), h('span', { class: 'hint' }, 'タップで開く')), ctxRow));
  }
}


// ---------------------------------------------------------------- 終了
function showEnd() {
  if (!S) return;
  const st = S.state;
  const card = $('endCard');
  clear(card);
  $('endSheet').hidden = false;
  $('resultBtn').hidden = false;
  $('phaseNow').textContent = '🏁 ゲーム終了';
  showStatus('🏁 ゲーム終了。🏁ボタンで結果を見られます');
  const w = st.winner;
  let title = w === 'village' ? '村人陣営の勝利！' : w === 'wolf' ? '人狼陣営の勝利！' : w === 'fox' ? '妖狐の勝利！（村か人狼の条件が満たされた時に妖狐が生きていました）' : '決着がつきませんでした';
  if (human != null && w && w !== 'draw') {
    const mine = ROLES[st.players[human].role].camp;
    title += mine === w ? '　🎉 あなたの勝ちです' : '　あなたの負けです';
  }
  const table = h('table', { class: 'rtable' }, h('tr', {}, h('th', {}, '名前'), h('th', {}, '役職'), h('th', {}, '性格'), h('th', {}, '結果')));
  for (const p of st.players) table.append(h('tr', {}, h('td', {}, nameEl(p.id, 26, p.id === human ? '（あなた）' : '')), h('td', {}, roleTag(p.role), ' ' + ROLES[p.role].name), h('td', {}, st.personalities[p.id].name), h('td', {}, p.alive ? '生存' : '死亡')));
  const code = encodeReplay({ v: 1, seed: curSeed, n: curN, human: human != null, role: curRole, rep: curRep || undefined, inputs: S.inputs });
  // 10. 推理の答え合わせ(人間の投票先が人狼だったか)
  let answer: HTMLElement | null = null;
  if (human != null) {
    const myVotes = st.events.filter((e): e is Extract<PublicEvent, { t: 'vote' }> => e.t === 'vote' && e.round === 0 && e.by === human);
    const hits = myVotes.filter((v) => ROLES[st.players[v.target].role].isWolf).length;
    const isWolfSide = ROLES[st.players[human].role].isWolf;
    const rows = myVotes.map((v) => h('span', { class: 'chip' }, `${v.day}日: ${plainName(v.target)}`, roleTag(st.players[v.target].role)));
    answer = h('div', { class: 'answer' },
      h('b', {}, isWolfSide ? '🐺 あなたの投票先' : `🔍 推理の答え合わせ: 人狼に投票 ${hits}/${myVotes.length}回`),
      h('div', { class: 'row', style: 'margin-top:4px' }, ...(rows.length ? rows : [h('span', { class: 'small dim' }, '投票なし')])),
    );
  }
  // 6. 戦績(端末内に保存。再生は数えない)
  let statsEl: HTMLElement | null = null;
  if (human != null && w && w !== 'draw') {
    const role = st.players[human].role;
    const won = ROLES[role].camp === w;
    const stats = loadStats();
    if (!isReplay && !statsDone) {
      statsDone = true;
      const r = (stats[role] ??= { games: 0, wins: 0 });
      r.games++;
      if (won) r.wins++;
      pref('stats', JSON.stringify(stats));
      // 騙り率の更新: この試合で人間がCOした役職が本当の役職と違えば「騙り」
      const rep = loadRep();
      const myCos = new Set(st.events.filter((e): e is Extract<PublicEvent, { t: 'say' }> => e.t === 'say' && e.by === human && (e.st.kind === 'co' || e.st.kind === 'result') && !!e.st.claim).map((e) => e.st.claim as string));
      for (const c of myCos) { rep.claims++; if (c !== role) rep.fakes++; }
      pref('rep', JSON.stringify(rep));
    }
    statsEl = statsTable(stats);
  }
  card.append(
    h('div', { class: 'row' }, h('h2', { style: 'margin:0' }, '🏁 ゲーム終了'), h('span', { class: 'spacer' }), h('button', { class: 'btn ghost small', onclick: () => ($('endSheet').hidden = true) }, '閉じる')),
    ...((w === 'village' || w === 'wolf' || w === 'fox') && EVENTS[`win_${w}`] ? [h('div', { class: 'evpic end', style: `background-image:url(${EVENTS[`win_${w}`]})` })] : []),
    h('div', { class: 'endT' }, title),
    ...(answer ? [answer] : []),
    table,
    ...(statsEl ? [statsEl] : []),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: openThink }, '🧠 AI思考を見る'),
      h('button', { class: 'btn ghost', onclick: () => startGame({ seed: curSeed, n: curN, play: human != null, inputs: S!.inputs.slice(), rep: curRep }) }, '▶ この試合をもう一度再生'),
      h('button', { class: 'btn ghost', onclick: () => startGame({ seed: newSeed(), n: curN, play: human != null }) }, '🎲 新しい試合'),
    ),
    h('div', { class: 'small' }, `seed = ${curSeed}（同じseedなら同じ配役・同じAI判断になります）`),
    h('details', {}, h('summary', {}, '再現コード（人間の入力も含めて完全再生）'), h('textarea', { class: 'code', readonly: 'readonly', rows: '3' }, code)),
  );
}

// 戦績(役職別の勝敗)。localStorage に保存
type Stats = Record<string, { games: number; wins: number }>;
function loadStats(): Stats {
  try { return JSON.parse(pref('stats') ?? '{}') as Stats; } catch { return {}; }
}
function statsTable(stats: Stats): HTMLElement {
  const keys = Object.keys(stats).filter((k) => stats[k].games > 0);
  const total = keys.reduce((a, k) => a + stats[k].games, 0);
  const wins = keys.reduce((a, k) => a + stats[k].wins, 0);
  const box = h('details', { class: 'stats' }, h('summary', {}, `📈 戦績: ${total}戦 ${wins}勝（${total ? Math.round((wins / total) * 100) : 0}%）`));
  const t = h('table', { class: 'rtable' }, h('tr', {}, h('th', {}, '役職'), h('th', {}, '試合'), h('th', {}, '勝ち'), h('th', {}, '勝率')));
  for (const k of keys) t.append(h('tr', {}, h('td', {}, roleTag(k as RoleId), ' ' + (ROLES[k as RoleId]?.name ?? k)), h('td', {}, String(stats[k].games)), h('td', {}, String(stats[k].wins)), h('td', {}, `${Math.round((stats[k].wins / stats[k].games) * 100)}%`)));
  const rep = loadRep();
  if (rep.claims >= 3) box.append(h('div', { class: 'small', style: 'margin-top:6px' }, `🎭 あなたの役職騙り率: ${Math.round((rep.fakes / rep.claims) * 100)}%（CO ${rep.claims}回中 ${rep.fakes}回が騙り）${repRate(rep) >= 0.34 ? ' — AIはあなたのCOを少し警戒します' : ''}`));
  box.append(t, h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn ghost small', onclick: () => { pref('stats', '{}'); pref('rep', '{}'); toast('戦績を消去しました'); box.replaceWith(statsTable({})); } }, '戦績を消去')));
  return box;
}

// ---------------------------------------------------------------- AI思考ビューア
function openThink() {
  if (!S) return;
  const st = S.state;
  const modal = $('thinkModal');
  modal.hidden = false;
  const ps = sel('thinkPlayer');
  clear(ps);
  for (const p of st.players) ps.append(h('option', { value: String(p.id) }, `${p.name}（${ROLES[p.role].name}／${st.personalities[p.id].name}）${p.id === human ? ' ★あなた' : ''}`));
  const firstAi = st.players.find((p) => p.id !== human);
  if (firstAi) ps.value = String(firstAi.id);
  renderThink();
}
function renderThink() {
  if (!S) return;
  const out = $('thinkOut');
  clear(out);
  const pid = Number(sel('thinkPlayer').value);
  const ag = S.agents[pid];
  if (!ag) {
    out.append(h('div', { class: 'dim' }, 'この席はあなた自身です（AIの思考はありません）。'));
    return;
  }
  const phaseName: Record<string, string> = { talk: '発言', vote: '投票', night: '夜行動', wolfplan: '作戦' };
  for (const e of ag.log) out.append(h('details', { class: 'think' }, h('summary', {}, `${e.day === 0 ? '初夜' : e.day + '日目'} ${phaseName[e.phase]} → ${e.chosen}`), h('pre', {}, formatThink(e))));
}

// ---------------------------------------------------------------- 大量対戦(ブラウザ)
let lastBatch: BatchResult | null = null;
function runBatchUI(count: number) {
  const n = Number(sel('nSel').value);
  const seed0 = Number(inp('batchSeed').value) || 1;
  const cfg = makeConfig(n);
  const runner = new BatchRunner({ games: count, seed0, cfg, audit: inp('auditChk').checked });
  const prog = $('batchProg');
  const t0 = performance.now();
  $('batchOut').textContent = '';
  clear($('anomList'));
  const loop = () => {
    runner.step(Math.max(5, Math.floor(count / 40)));
    prog.textContent = `実行中… ${runner.done}/${count}`;
    if (runner.done < count) return void setTimeout(loop, 0);
    const res = runner.finish();
    lastBatch = res;
    prog.textContent = `完了: ${count}試合 (${((performance.now() - t0) / 1000).toFixed(1)}秒)`;
    $('batchOut').textContent = summaryText(res);
    for (const a of res.anomalies.slice(0, 20)) {
      $('anomList').append(h('div', { class: 'anom' }, `seed=${a.seed} [${a.kind}] ${a.message} `, h('button', { class: 'btn small ghost', onclick: () => startGame({ seed: a.seed, n, play: false }) }, '再生')));
    }
    $('dlRow').hidden = false;
  };
  loop();
}

// ---------------------------------------------------------------- 初期化
function init() {
  for (const n of Object.keys(ROLE_PRESETS)) sel('nSel').append(h('option', { value: n }, `${n}人村`));
  sel('nSel').value = pref('n') ?? '7';
  fillRoleSel(Number(sel('nSel').value));
  sel('nSel').addEventListener('change', () => fillRoleSel(Number(sel('nSel').value)));
  sel('modeSel').value = pref('mode') ?? 'play';
  sel('speedSel').value = pref('speed') ?? 'mid';
  inp('dialectChk').checked = (pref('dialect') ?? '1') === '1';
  inp('dialectChk').addEventListener('change', () => pref('dialect', inp('dialectChk').checked ? '1' : '0'));
  const rules = $('rulesList');
  for (const r of RULES_QUICK) rules.append(h('li', {}, r));

  $('startBtn').addEventListener('click', () => startGame());
  $('diceBtn').addEventListener('click', () => (inp('seedInput').value = String(newSeed())));
  $('pauseBtn').addEventListener('click', () => {
    paused = !paused;
    $('pauseBtn').textContent = paused ? '▶' : '⏸';
    if (!paused) scheduleTick(0);
  });
  $('skipBtn').addEventListener('click', () => {
    if (!S) return;
    sel('speedSel').value = 'max';
    paused = false;
    $('pauseBtn').textContent = '⏸';
    scheduleTick(0);
  });
  $('setupBtn').addEventListener('click', () => { clear($('statsBox')); $('statsBox').append(statsTable(loadStats())); $('setupSheet').hidden = false; });
  $('setupClose').addEventListener('click', () => ($('setupSheet').hidden = true));
  $('infoClose').addEventListener('click', () => ($('infoSheet').hidden = true));
  $('resultBtn').addEventListener('click', () => ($('endSheet').hidden = false));
  for (const id of ['setupSheet', 'infoSheet', 'endSheet']) $(id).addEventListener('click', (e) => { if (e.target === $(id)) $(id).hidden = true; });
  const feed = $('feed');
  feed.addEventListener('scroll', () => {
    if (Date.now() < progScrollUntil) return; // 自動スクロール中
    stickBottom = Math.abs(logEndTop() - feed.scrollTop) < 40; // 手で動かしている間(盤面を見ているなど)はパネル増減で追従しない
  });
  $('filterClear').addEventListener('click', () => setFilter(null));
  // 行動パネルが出てログ欄が縮んだとき、最後の発言がパネルの下に隠れないように末尾へ追従する
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => {
      if (stickBottom) {
        progScrollUntil = Date.now() + 50;
        feed.scrollTop = logEndTop();
      }
    });
    ro.observe(feed);
  }
  sel('speedSel').addEventListener('change', () => pref('speed', sel('speedSel').value));
  inp('devChk').addEventListener('change', () => {
    // 開発者モード: プレイ中でも役職を表示する(ネタバレ注意)。表示済みの内容も更新する。
    renderSide();
    renderFeedAll();
  });
  $('codeBtn').addEventListener('click', () => {
    const c = decodeReplay(inp('codeInput').value);
    if (!c) return void toast('再現コードを読み取れませんでした');
    startGame({ seed: c.seed, n: c.n, play: c.human, role: (c.role as RoleId | null) ?? null, inputs: c.inputs, rep: c.rep ?? 0 });
  });
  sel('thinkPlayer').addEventListener('change', renderThink);
  $('thinkClose').addEventListener('click', () => ($('thinkModal').hidden = true));
  $('thinkModal').addEventListener('click', (e) => {
    if (e.target === $('thinkModal')) $('thinkModal').hidden = true;
  });
  for (const c of [1, 100, 1000]) $('batch' + c).addEventListener('click', () => runBatchUI(c));
  $('dlCsv').addEventListener('click', () => lastBatch && download('games.csv', recordsToCsv(lastBatch.records), 'text/csv'));
  $('dlJson').addEventListener('click', () => lastBatch && download('summary.json', JSON.stringify({ summary: lastBatch.summary, anomalies: lastBatch.anomalies }, null, 2), 'application/json'));

  // URLハッシュ(#seed=18427&n=7&mode=watch)で特定の試合を直接開ける
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  const seed = Number(q.get('seed'));
  if (Number.isFinite(seed) && q.get('seed')) startGame({ seed, n: Number(q.get('n')) || Number(sel('nSel').value), play: q.get('mode') !== 'watch', role: q.get('role') ? (q.get('role') as RoleId) : undefined });
  else startGame();
}

init();
