import { RULE_SCALE_BY_N } from './rule-scale.gen';
import { ruleKey } from './rulekey';
import type { Color, Personality, ReasonKey, RoleId } from '../game/types';
import type { PublicEvent } from '../game/types';
import type { PlayerObservation } from '../observations/observation';
import type { Rng } from '../util/rng';
import type { Flags } from './flags';

// ============================================================================
//  Belief = 各プレイヤーが「誰をどれくらい人狼だと思っているか」(疑惑度 0〜100)
//  - 観測(PlayerObservation)だけから更新する。真の役職は参照しない。
//  - 変化の理由は台帳(ledger)に残し、「AI思考を見る」で後から確認できる。
// ============================================================================

// 疑惑度の増減の大きさ(ここを変えるとAIの癖が変わる)。単位はポイント。
export const W = {
  seerBlack: 58, // 占い師の黒判定(信憑性100%のとき)
  seerWhite: 60, // (第18版 均衡探索: 30→60) // 占い師の白判定
  fakeSeer: 110, // (第18版: 55→110) // 占い師COが偽物だったときに付く疑惑(信憑性が低いほど加算)
  fakeReverse: 0, // 偽物の判定は逆に読む強さ(偽の黒先は白寄り、偽の白先は黒寄り)。調整の結果0が最善(0.35→0で村側+5pt。逆読みは狂人の適当な判定にも引きずられる)
  silent: 3.5, // その日ほぼ発言なし
  lateChange: 10, // 宣言と投票が違う(人狼の身内切り・票合わせで起きやすく、94%が人狼に付く強い手がかり)
  accuseTrusted: 4.5, // 自分が信頼する人を疑った人
  accuseConfirmedWhite: 9, // 確定白(共有者など)を疑った人
  accuseSame: -2, // 自分と同じ人を疑った人
  lynchBlackVoter: -12, // (第18版: -6→-12) // 黒だった処刑者に投票していた人
  lynchWhiteVoter: 5, // 白だった処刑者に投票していた人
  seerVotePenalty: 24, // (第18版: 48→24) // 本物らしい占い師を疑う/吊る候補から外す強さ(信憑性に比例)
  defendBlack: 10, // 黒だった処刑者をかばっていた人
  certainBlack: 99, // 自分の占いで黒
  certainWhite: 4, // 自分の占いで白
  fakeMedium: 70, // 自分が霊能者のとき、他の霊能者CO
  masonTrust: -24, // 共有者CO(定員以内)
  fakeMason: 80, // 自分が共有者のとき、相方以外の共有者CO
  hunterTrust: -10, // 狩人CO(定員以内)
  brokenSeer: 60, // 占いの黒が定員内の霊能結果(白)と食い違った(破綻)占い師CO
  hunterUnbitten: 18, // 狩人COの翌朝に誰かが死んだ(=人狼は狩人COを噛みに行かなかった)ときの疑い(×晩数)
  hunterGj: -15, // 狩人COの護衛成功報告が平和な朝と一致(判定チェック○): 人狼が噛みに行って護衛で止めた形=本物寄り
  hunterGjBroken: 45, // 護衛成功と報告したのに今朝は死者が出ている(判定チェック×): 偽物
  hunterRivalBlack: -12, // 対抗の狩人COが処刑されて霊能結果が黒だった: 残った定員内の狩人COは本物寄り
  seerUnbitten: 0, // 占いCOが2人以上で誰も噛まれない朝ごとに占いCO全員へ(×晩数)。検証で村側−7pt(本物まで吊る)だったので0。会話の種としてだけ残す
  fakeConfirmedComp: 25, // 本物らしい占い師が噛まれたあとに残った占いCO(2人以上)への疑い。狂人が噛まれた可能性もあるので「確定」ではなく「可能性が高い」
  fakeConfirmedRaw: 0.3, // 同・残った占いCOの信憑性(生の値)の上限(0.03→0.3: 確定扱いにしない。勝率は同じ)
  fakeConfirmedReverse: 0.2, // 偽物の可能性が高い占いの判定を軽く逆に読む(囲いの白→やや黒寄り)。破綻は別途強く
  waverPoint: 0, // ブレを指摘された人(検証で差がなかったので0。会話だけ)
  biteLogic: 0, // 噛まれた人が疑っていた人(+)(検証で差がなかったので0。会話だけ)
  biteLogicWhite: 5, // 噛まれた人がかばっていた人(−)(正解率75%)
  silentPoint: 2, // 沈黙を指摘された人
  coTiming: 0.08, // COの速さ: 先に出た占い師COの信憑性 ×(1+coTiming)、後出し ×(1−coTiming) // 狩人COが噛まれずに夜を越した(1晩ごとに加算。人狼は仲間を噛まない)
  mediumTrust: -12, // 霊能CO(定員内)。霊能騙りは稀なので1COの霊能はほぼ本物として扱う
  mediumVotePenalty: 45, // 定員内の霊能COを疑う/吊る候補から外す強さ(役職吊りは最終手段)
  hunterVotePenalty: 30, // 定員内の狩人COを疑う/吊る候補から外す強さ
  matchGain: 0.9, // 占い師の判定が霊能結果などと一致したときの信憑性の伸び(1+matchGain*q 倍)
  compPow: 2.5, // 占い師COへの疑い (1-信憑性)^compPow の指数(調整: 1→2.5。本物らしくなった占い師への疑いを早く消す)
  whitePow: 2, // 占い師の白判定を信憑性^whitePow で効かせる(囲い対策: 真偽不明の白は信じない)
};

export interface LedgerItem {
  label: string;
  delta: number;
  day: number;
  rk?: ReasonKey;
}
interface SeerResult {
  target: number;
  color: Color;
  day: number;
  applied: number;
}
export interface SeerClaim {
  by: number;
  day: number;
  results: SeerResult[];
  raw: number;
  fakeComp: number;
  note?: string;
  broken?: boolean;
  fakeConfirmed?: boolean; // 本物が噛まれたことで偽物が確定した
  timingDone?: boolean; // COの速さをすでに反映したか // 破綻(黒判定が霊能の白と矛盾)が確定した
  noteDir?: number; // note が示す向き(-1=信憑性が上がった / +1=下がった)。台帳のラベルは向きが合うときだけ note を使う
  cursedCredit?: boolean; // 呪殺の手柄をすでに反映したか
  gjCredit?: boolean; // 狩人の護衛成功報告をすでに反映したか
}
interface MediumClaim {
  by: number;
  day: number;
  comp: number;
}
interface MasonClaim {
  by: number;
  comp: number;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const cw = (c: Color) => (c === 'black' ? '黒' : '白');

export interface BeliefOpts {
  me: number;
  n: number;
  selfRole: RoleId;
  names: string[];
  personality: Personality;
  usePrivate: boolean; // 占い結果・霊能結果などの非公開情報を取り込むか
  roleCounts: Readonly<Record<RoleId, number>>;
  rng: Rng;
  flags: Flags;
  w?: Partial<typeof W>; // 疑惑度の重み(W)の上書き(検証・調整用)
  humanSeat?: number | null; // 人間の席(人間の過去の騙り率で警戒するため)
  humanRep?: number; // 人間の過去の役職騙り率(0〜1)
}

export class Belief {
  readonly me: number;
  readonly n: number;
  readonly selfRole: RoleId;
  readonly names: string[];
  private ruleScale: Record<string, number>;
  private humanSeat: number | null;
  private humanRep: number;
  // 人間プレイヤーの過去の騙り率による警戒(その人のCOのたびに一度だけ)
  private repWarned = false;
  private warnHuman(by: number, claim: string) {
    if (by !== this.humanSeat || by === this.me || this.repWarned || this.humanRep < 0.34) return;
    this.repWarned = true;
    const pct = Math.round(this.humanRep * 100);
    this.add(by, 6 + this.humanRep * 20, `過去の試合で役職騙りが多い人(${pct}%)の${claim}CO。警戒する`, 'fake_seer');
    const c = this.seerClaims.get(by);
    if (c && claim === '占い師') c.raw *= 1 - this.humanRep * 0.5;
  }
  readonly p: Personality;
  readonly usePrivate: boolean;
  readonly counts: Readonly<Record<RoleId, number>>;
  readonly f: Flags;
  susp: number[];
  ledger: LedgerItem[][];
  private W: typeof W;
  seerClaims = new Map<number, SeerClaim>();
  mediumClaims = new Map<number, MediumClaim>();
  masonClaims = new Map<number, MasonClaim>();
  hunterClaims = new Set<number>();
  private hunterClaimDay = new Map<number, number>();
  private hunterSurvived = new Map<number, number>(); // 狩人CO後、噛まれずに越した夜の数
  private hunterGjDay = new Set<number>(); // 護衛報告の判定チェック済み(by*100+day)
  // 自分が公開した役職(本物でも騙りでも)。自分が占い師を名乗った以上、対抗の占い師の判定は(表向き)信じない=視点の整合性
  myClaim: 'seer' | 'medium' | null = null;
  // 何かの役職をCOしている人(占い・霊能・狩人・共有者)。占い先の候補から外す(セオリー: 占いはグレーから)
  hasClaimed(i: number): boolean {
    return this.seerClaims.has(i) || this.mediumClaims.has(i) || this.masonClaims.has(i) || this.hunterClaims.has(i);
  }
  stance = new Map<number, number>(); // 今日の各人の「最新の矛先」(疑い/賛成/投票宣言)
  lastAccuse: { by: number; target: number } | null = null;
  aliveNow: boolean[];
  confirmed = new Map<number, Color>(); // 霊能で白黒が判明した処刑者
  attacked = new Set<number>(); // 夜に死んだ人(襲撃死または呪殺。どちらも人狼ではない)
  private deathsByDay = new Map<number, number[]>(); // 朝ごとの死者(2人以上なら呪殺が混ざっている)
  day = 0;

  private cursor = 0;
  private seerPriv = 0;
  private medPriv = 0;
  private masonPriv = false;
  private masonMates = new Set<number>();
  private stanceDay = -1;
  private stanceByDay = new Map<number, Map<number, number>>(); // day → (人 → その日の最後の矛先)
  private askedToday = new Map<number, number>(); // 指名して意見を求められた人 → その日
  private intents = new Map<number, Map<number, number>>();
  private votes = new Map<number, Map<number, number>>();
  private defends = new Map<number, { by: number; target: number }[]>();
  private spoke = new Map<number, Map<number, number>>();
  private execs: { day: number; target: number }[] = [];
  private lateDone = new Set<number>();

  constructor(o: BeliefOpts) {
    this.me = o.me;
    this.n = o.n;
    this.selfRole = o.selfRole;
    this.names = o.names;
    this.humanSeat = o.humanSeat ?? null;
    this.humanRep = o.humanRep ?? 0;
    // 人数別の学習倍率(その人数の表がなければ一番近い人数のもの)
    { const ns = Object.keys(RULE_SCALE_BY_N).map(Number); const best = ns.sort((a, b) => Math.abs(a - o.n) - Math.abs(b - o.n))[0]; this.ruleScale = RULE_SCALE_BY_N[String(best)] ?? {}; }
    this.p = o.personality;
    this.usePrivate = o.usePrivate;
    this.counts = o.roleCounts;
    this.f = o.flags;
    this.W = { ...W, ...(o.w ?? {}) };
    this.aliveNow = Array(o.n).fill(true);
    this.susp = Array(o.n).fill(0);
    this.ledger = Array.from({ length: o.n }, () => []);
    const base = clamp(Math.round((100 * o.roleCounts.werewolf) / (o.n - 1)), 18, 45);
    const sigma = 1.5 + o.personality.noise * 0.05; // 第一印象のばらつき(気分屋でも±10程度に収める)
    for (let i = 0; i < o.n; i++) {
      if (i === o.me) continue;
      const imp = Math.round(o.rng.gauss() * sigma * 10) / 10;
      this.susp[i] = clamp(base + imp, 1, 99);
      this.ledger[i].push({ label: '初期値(人数比)', delta: base, day: 0 });
      if (Math.abs(imp) >= 0.1) this.ledger[i].push({ label: '第一印象(乱数)', delta: imp, day: 0 });
    }
  }

  // ---- 疑惑度の加減算 ----
  private scale(d: number): number {
    // 攻撃的な人は疑う方向に、信用しやすい人は信じる方向に、より強く動く
    return d > 0 ? d * (0.6 + (this.p.aggression / 100) * 0.8) : d * (0.6 + (this.p.trust / 100) * 0.8);
  }
  private apply(i: number, d: number, label: string, rk?: ReasonKey) {
    if (this.masonMates.has(i) && this.masonPriv && d > 0 && this.susp[i] <= 1) return; // 相方の共有者は確定白。疑惑は付かない
    // 学習したルール倍率(数万試合のロジスティック回帰で「このルールの増分はどれだけ人狼を当てるか」を推定したもの)
    if (this.f.on('v_learned_scale')) { const m = this.ruleScale[ruleKey(label, this.names)]; if (m != null) d *= m; }
    const before = this.susp[i];
    const after = clamp(before + d, 1, 99);
    const real = after - before;
    if (Math.abs(real) < 0.05) return;
    this.susp[i] = after;
    this.ledger[i].push({ label, delta: Math.round(real * 10) / 10, day: this.day, rk });
  }
  private add(i: number, d: number, label: string, rk?: ReasonKey) {
    if (i === this.me || !this.aliveNow[i]) return;
    this.apply(i, this.scale(d), label, rk);
  }
  private addRaw(i: number, d: number, label: string, rk?: ReasonKey) {
    if (i === this.me || !this.aliveNow[i]) return;
    this.apply(i, d, label, rk);
  }
  private nm(i: number) {
    return this.names[i];
  }
  // 確定白(自分の占いで白・相方の共有者・CO定員内の共有者)か
  isConfirmedWhite(i: number): boolean {
    return this.susp[i] <= 6 || (this.f.on('v_mason_white') && this.masonClaims.has(i) && this.masonClaims.size <= this.counts.mason);
  }

  // ---- 観測の取り込み ----
  update(obs: PlayerObservation) {
    if (this.usePrivate) this.onPrivate(obs); // 相方の共有者など、公開イベントの解釈に必要な非公開情報を先に取り込む
    const evs = obs.events;
    for (; this.cursor < evs.length; this.cursor++) this.onEvent(evs[this.cursor]);
    this.refreshSeer();
    this.refreshClaims();
  }

  private onPrivate(obs: PlayerObservation) {
    const sr = obs.priv.seerResults;
    if (sr) {
      for (; this.seerPriv < sr.length; this.seerPriv++) {
        const r = sr[this.seerPriv];
        if (r.color === 'black') this.addRaw(r.target, this.W.certainBlack - this.susp[r.target], `自分の占いで黒(${this.nm(r.target)})`);
        else this.addRaw(r.target, this.W.certainWhite - this.susp[r.target], `自分の占いで白(${this.nm(r.target)})`);
      }
    }
    const mr = obs.priv.mediumResults;
    if (mr) {
      for (; this.medPriv < mr.length; this.medPriv++) this.confirmExec(mr[this.medPriv].target, mr[this.medPriv].color, 1);
    }
    const mm = obs.priv.masonMates;
    if (mm && !this.masonPriv) {
      this.masonPriv = true;
      for (const m of mm) {
        this.masonMates.add(m);
        this.addRaw(m, 1 - this.susp[m], `共有者の相方(${this.nm(m)})`);
      }
    }
  }

  private onEvent(ev: PublicEvent) {
    switch (ev.t) {
      case 'phase':
        if (ev.phase === 'night' && ev.day >= 1) this.endOfDay(ev.day);
        if (ev.phase === 'day' && ev.day >= 2) {
          this.day = Math.max(this.day, ev.day);
          this.checkHunterUnbitten(ev.day);
          this.checkSeerUnbitten(ev.day);
        }
        break;
      case 'say':
        if (ev.day !== this.stanceDay) {
          this.stance = new Map();
          this.stanceByDay.set(ev.day, this.stance);
          this.stanceDay = ev.day;
          this.lastAccuse = null;
        }
        this.day = Math.max(this.day, ev.day);
        this.onSay(ev);
        break;
      case 'vote': {
        this.day = Math.max(this.day, ev.day);
        let m = this.votes.get(ev.day);
        if (!m) this.votes.set(ev.day, (m = new Map()));
        m.set(ev.by, ev.target);
        if (ev.round === 0 && ev.by !== this.me && !this.lateDone.has(ev.day * 100 + ev.by)) {
          const intent = this.intents.get(ev.day)?.get(ev.by);
          if (intent != null && intent !== ev.target) {
            this.lateDone.add(ev.day * 100 + ev.by);
            this.add(ev.by, this.W.lateChange, `宣言(${this.nm(intent)})と投票(${this.nm(ev.target)})が違う`, 'late_change');
          }
        }
        break;
      }
      case 'execute':
        this.execs.push({ day: ev.day, target: ev.target });
        this.aliveNow[ev.target] = false;
        break;
      case 'death': {
        this.aliveNow[ev.target] = false;
        this.attacked.add(ev.target);
        const list = this.deathsByDay.get(ev.day) ?? [];
        list.push(ev.target);
        this.deathsByDay.set(ev.day, list);
        this.onAttacked(ev.target);
        if (this.curseLikely(ev.day)) this.onCurse(ev.day);
        break;
      }
      default:
        break;
    }
  }

  private onSay(ev: Extract<PublicEvent, { t: 'say' }>) {
    const { by, st, day } = ev;
    let m = this.spoke.get(day);
    if (!m) this.spoke.set(day, (m = new Map()));
    if (st.kind !== 'wait') m.set(by, (m.get(by) ?? 0) + 1);
    if (by === this.me) {
      if ((st.kind === 'co' || st.kind === 'result') && (st.claim === 'seer' || st.claim === 'medium')) this.myClaim = st.claim;
      return;
    }
    switch (st.kind) {
      case 'co':
      case 'result':
        if (st.claim === 'seer') this.regSeer(by, day, st.target, st.color);
        else if (st.claim === 'medium') this.regMedium(by, day, st.target, st.color);
        else if (st.claim === 'hunter') this.regHunter(by, st.kind === 'result' ? st.target : undefined);
        else if (st.claim === 'mason') this.regMason(by);
        break;
      case 'vote_review':
      case 'medium_review':
      case 'line':
        // 考察による指摘: 疑いとほぼ同じ扱い(名指しとして熱に数える)。ラインは相手(ref)にも弱く
        if (st.target != null) {
          this.stance.set(by, st.target);
          this.lastAccuse = { by, target: st.target };
          this.socialAccuse(by, st.target);
          if (st.kind === 'line' && st.ref != null && st.ref !== this.me && this.susp[st.target] > 55) this.add(st.ref, 3, `${this.nm(st.target)}とのラインを指摘された`);
        }
        break;
      case 'propose':
        // 進行提案: 「今日の吊り先」の矛先として熱に数える
        if (st.plan === 'black' && st.target != null) this.stance.set(by, st.target);
        else if (st.plan === 'roller') {
          const t = this.leastTrustedClaimant();
          if (t != null && t !== by) this.stance.set(by, t);
        } else if (st.plan === 'grey') {
          const t = this.topGrey();
          if (t != null && t !== by) this.stance.set(by, t);
        }
        break;
      case 'attack_review':
        break;
      case 'waver':
        // ブレの指摘: 会話の取っ掛かり。推理には使わない(--rules で人狼と村側の差がゼロだった。矛先にも数えない)
        if (st.target != null && this.f.on('v_waver')) this.add(st.target, this.W.waverPoint, `${this.nm(by)}にブレを指摘された`, 'vote_hist');
        break;
      case 'bite_logic':
        // 噛み筋: 「かばっていた人は白寄り」は正解率75%で使う。「疑っていた人は黒寄り」は差がゼロだったので会話だけ(矛先にも数えない)
        if (st.target != null && this.f.on('v_bite_logic')) {
          if (st.color === 'black') this.add(st.target, this.W.biteLogic, `噛まれた${st.ref != null ? this.nm(st.ref) : '人'}が疑っていた(噛み筋)`, 'kill_contra');
          else this.add(st.target, -this.W.biteLogicWhite, `噛まれた${st.ref != null ? this.nm(st.ref) : '人'}がかばっていた(噛み筋)`);
        }
        break;
      case 'confirm':
        // 確定の宣言: 矛先として数えると、噛まれた本物の残り(偽物=人狼か狂人)を吊る流れが強まり村側−1.3pt(狂人吊りで1日消える)。
        // 発言としては自然なので残し、推理・熱には使わない(破綻の確定だけは矛先に数える)
        if (st.target != null && st.reason === 'broken') {
          this.stance.set(by, st.target);
          this.lastAccuse = { by, target: st.target };
        }
        break;
      case 'co_timing': {
        const c = st.target != null ? this.seerClaims.get(st.target) : undefined;
        if (c && this.f.on('v_co_timing') && !c.timingDone) {
          c.timingDone = true;
          c.raw *= st.tag === 'late' ? 1 - this.W.coTiming : 1 + this.W.coTiming;
          c.note = st.tag === 'late' ? '後出しのCO' : '迷わず出たCO';
          c.noteDir = st.tag === 'late' ? 1 : -1;
        }
        break;
      }
      case 'ask':
        if (st.target != null) this.askedToday.set(st.target, day);
        break;
      case 'silent_point':
        if (st.target != null) {
          this.stance.set(by, st.target);
          this.add(st.target, this.W.silentPoint, `${this.nm(by)}に沈黙を指摘された`, 'vague');
        }
        break;
      case 'count':
        break;
      case 'accuse':
        if (st.target != null) {
          this.stance.set(by, st.target);
          this.lastAccuse = { by, target: st.target };
          this.socialAccuse(by, st.target);
        }
        break;
      case 'agree':
        if (st.target != null) this.stance.set(by, st.target);
        break;
      case 'vote_intent':
        if (st.target != null) {
          this.stance.set(by, st.target);
          let im = this.intents.get(day);
          if (!im) this.intents.set(day, (im = new Map()));
          im.set(by, st.target);
        }
        break;
      case 'defend':
      case 'disagree': {
        if (st.target != null) {
          let d = this.defends.get(day);
          if (!d) this.defends.set(day, (d = []));
          d.push({ by, target: st.target });
        }
        break;
      }
      default:
        break;
    }
  }

  private socialAccuse(by: number, target: number) {
    if (target === this.me) return;
    if (this.f.on('v_mason_white') && this.isConfirmedWhite(target)) this.add(by, this.W.accuseConfirmedWhite, `確定白の${this.nm(target)}を疑った`, 'vote_hist');
    else if (this.susp[target] < 25) this.add(by, this.W.accuseTrusted, `信頼している${this.nm(target)}を疑った`);
    else if (this.susp[target] > 65) this.add(by, this.W.accuseSame, `私と同じく${this.nm(target)}を疑っている`);
  }

  private regSeer(by: number, day: number, target?: number, color?: Color) {
    let c = this.seerClaims.get(by);
    if (!c) {
      c = { by, day, results: [], raw: 1, fakeComp: 0 };
      this.seerClaims.set(by, c);
      this.warnHuman(by, '占い師');
    }
    if (target != null && color && !c.results.some((r) => r.target === target)) {
      c.results.push({ target, color, day, applied: 0 });
      // 呪殺が出た朝に死んだ人への白判定 → 占っていたのは本物らしい
      if (color === 'white' && this.attacked.has(target) && this.curseLikely(day) && (this.deathsByDay.get(day) ?? []).includes(target)) {
        this.applyCurseEvidence(target, day);
        return;
      }
      // すでに白黒が判明している人への判定なら、その場で信憑性に反映(白の一致は弱い根拠)
      const known = this.knownColor(target);
      if (known) this.judgeClaim(c, known === color, `${this.nm(target)}への判定が既知の結果と${known === color ? '一致' : '矛盾'}`, known === color && color === 'white' ? this.whiteMatchW() : 1);
      // 他の占い師COと同じ人に別の色 → どちらかは偽物
      this.crossCheckSeer(c, target, color);
    }
  }
  private regMedium(by: number, day: number, target?: number, color?: Color) {
    if (!this.mediumClaims.has(by)) {
      this.mediumClaims.set(by, { by, day, comp: 0 });
      this.warnHuman(by, '霊能者');
      if (this.mediumView()) this.add(by, this.W.fakeMedium, `霊能者を名乗った(本物は私)`, 'fake_seer');
      // 霊能騙りは稀(騙っても得が少ない)ので、定員内の霊能COはほぼ本物として扱う
      else if (this.mediumClaims.size <= this.counts.medium) this.add(by, this.W.mediumTrust, '霊能CO(定員内)');
    }
    if (target != null && color && !this.mediumView()) {
      const q = 0.92 / Math.max(1, this.mediumClaims.size);
      this.confirmExec(target, color, q);
    }
  }
  private regMason(by: number) {
    if (this.masonClaims.has(by)) return;
    this.masonClaims.set(by, { by, comp: 0 });
    if (this.usePrivate && this.selfRole === 'mason' && !this.masonMates.has(by)) this.add(by, this.W.fakeMason, `共有者を名乗った(相方ではない)`, 'fake_mason');
  }
  // 生きている狩人COの人数(定員の判定は生存者で数える。処刑・襲撃で消えたCOは枚数に入れない)
  aliveHunterClaims(): number {
    let n = 0;
    for (const h of this.hunterClaims) if (this.aliveNow[h]) n++;
    return n;
  }
  // 狩人COの翌朝の「判定チェック」。人狼は狩人COを噛みに行くのが定石なので、朝の結果で2通りに読む。
  //  ・平和な朝(死者なし) → 人狼が噛みに行き、護衛で止めた形。生き残った狩人COは本物寄り(護衛成功の判定チェック)
  //  ・誰かが死んだ → 人狼は狩人COを噛みに行かなかった=仲間(人狼)の可能性。噛まれない晩が続くほど疑いが増す
  private checkHunterUnbitten(day: number) {
    if (!this.f.on('v_hunter_unbitten')) return;
    const peace = (this.deathsByDay.get(day) ?? []).length === 0;
    for (const h of this.hunterClaims) {
      if (!this.aliveNow[h] || h === this.me) continue;
      const cd = this.hunterClaimDay.get(h) ?? day;
      if (cd >= day) continue; // 今日COしたばかり(まだ夜を越していない)
      if (peace) continue; // 平和な朝=護衛成功の可能性。疑わない。本物寄りの加点は本人の護衛報告(regHunter)が朝の結果と一致したときに行う
      const n = (this.hunterSurvived.get(h) ?? 0) + 1;
      this.hunterSurvived.set(h, n);
      this.add(h, this.W.hunterUnbitten * n, `狩人COなのに${n}晩噛まれていない(人狼は仲間を噛まない)`, 'fake_hunter');
    }
  }
  // 狩人COが噛まれずに越した夜の数(0なら吊り候補から外す減点が効く)
  hunterUnbittenNights(t: number): number {
    return this.hunterSurvived.get(t) ?? 0;
  }
  private regHunter(by: number, guarded?: number) {
    if (!this.hunterClaims.has(by)) {
      this.hunterClaims.add(by);
      this.warnHuman(by, '狩人');
      this.hunterClaimDay.set(by, this.day);
      if (this.aliveHunterClaims() <= this.counts.hunter) this.add(by, this.W.hunterTrust, '狩人CO(定員内)');
    }
    // 護衛成功の報告の判定チェック: 今朝が平和な朝(死者なし)で守った相手が生きていれば報告と事実が一致=本物寄り。
    // 今朝に死者が出ているのに「守った」と言うのは矛盾(偽物)。人狼は狩人COを噛みに行くのが定石なので、噛みに来て止めた形は真の狩人らしい
    if (guarded != null && by !== this.me && !this.hunterGjDay.has(by * 100 + this.day)) {
      this.hunterGjDay.add(by * 100 + this.day);
      const peace = (this.deathsByDay.get(this.day) ?? []).length === 0;
      if (!peace || !this.aliveNow[guarded]) this.add(by, this.W.hunterGjBroken, `護衛成功と言うが今朝は死者が出ている(判定チェック×・矛盾)`, 'broken');
      else if (this.aliveHunterClaims() <= this.counts.hunter) this.add(by, this.W.hunterGj, `護衛成功の報告が平和な朝と一致(判定チェック○)。人狼が噛みに来て守った形=本物寄り`, 'hunter_gj');
    }
    const reportOk = guarded != null && (this.deathsByDay.get(this.day) ?? []).length === 0 && this.aliveNow[guarded];
    if (guarded != null && reportOk && this.aliveHunterClaims() <= this.counts.hunter) {
      const c = this.seerClaims.get(guarded);
      if (c && !c.gjCredit) {
        c.gjCredit = true;
        c.raw *= 1.5;
        c.note = `狩人${this.nm(by)}が護衛成功を報告(人狼に狙われた=本物寄り)`;
      }
    }
  }
  // 一番信憑性の低い生存占い師CO
  leastTrustedClaimant(): number | null {
    let best: number | null = null;
    for (const c of this.seerClaims.values()) if (c.by !== this.me && this.aliveNow[c.by] && (best == null || this.seerTrust(c.by) < this.seerTrust(best))) best = c.by;
    return best;
  }
  // 役職COしていない生存者のうち、一番疑わしい人
  topGrey(): number | null {
    let best: number | null = null;
    for (let i = 0; i < this.n; i++) {
      if (i === this.me || !this.aliveNow[i] || this.seerClaims.has(i) || this.mediumClaims.has(i) || this.hunterClaims.has(i) || this.masonClaims.has(i)) continue;
      if (best == null || this.susp[i] > this.susp[best]) best = i;
    }
    return best;
  }
  // その人の(直近の日の)発言回数
  spokeCount(p: number): number {
    const m = this.spoke.get(this.day);
    return m?.get(p) ?? 0;
  }
  // その日の各人の最後の矛先(疑い/賛成/投票宣言/指摘)
  stanceOn(day: number): Map<number, number> | undefined {
    return this.stanceByDay.get(day);
  }
  // その日にその人がかばった相手
  defendsOn(day: number): { by: number; target: number }[] {
    return this.defends.get(day) ?? [];
  }
  // 今日、指名して意見を求められたか
  wasAsked(p: number, day: number): boolean {
    return this.askedToday.get(p) === day;
  }
  // 占い師COの出た順番(0が最初)。COしていなければ -1
  seerCoIndex(p: number): number {
    return [...this.seerClaims.keys()].indexOf(p);
  }
  // 襲撃された占い師CO(本物と見られる)
  attackedSeerClaimants(): number[] {
    return [...this.seerClaims.keys()].filter((c) => this.attacked.has(c));
  }
  // 昨日の投票(公開情報)
  votesOn(day: number): Map<number, number> | undefined {
    return this.votes.get(day);
  }
  // 昨日の処刑者
  executedOn(day: number): number | null {
    return this.execs.find((e) => e.day === day)?.target ?? null;
  }
  // 朝に死んだ人(その日)
  deathsOn(day: number): number[] {
    return this.deathsByDay.get(day) ?? [];
  }
  // 信頼できる占い師の黒先で生きている人
  trustedBlackTargets(): number[] {
    const out: number[] = [];
    for (const c of this.seerClaims.values()) {
      const t = this.usePrivate && this.selfRole === 'seer' ? 0 : this.seerTrust(c.by);
      if (t < 0.45) continue;
      for (const r of c.results) if (r.color === 'black' && this.aliveNow[r.target] && r.target !== this.me && !out.includes(r.target)) out.push(r.target);
    }
    if (this.usePrivate && this.selfRole === 'seer') for (let i = 0; i < this.n; i++) if (this.aliveNow[i] && this.ledger[i].some((x) => x.label.startsWith('自分の占いで黒')) && !out.includes(i)) out.push(i);
    return out;
  }

  // 公開情報で判明している色: 襲撃された=白、霊能で判明した処刑者
  private knownColor(t: number): Color | null {
    if (this.attacked.has(t)) return 'white';
    return this.confirmed.get(t) ?? null;
  }
  // 白判定が当たる事前確率は高い(人外の割合ぶんだけ外れる)ので、白の一致はその分だけ割り引く
  private whiteMatchW(): number {
    const alive = Math.max(2, this.aliveCount());
    return clamp((this.counts.werewolf + this.counts.fox) / (alive - 1), 0.15, 0.5) * 1.2;
  }
  // 占い師同士の矛盾: 同じ人に別の色を出した2人は、少なくとも一方が偽物(両方とも少し信憑性を下げる)
  private crossCheckSeer(c: SeerClaim, target: number, color: Color) {
    for (const o of this.seerClaims.values()) {
      if (o.by === c.by) continue;
      const r = o.results.find((x) => x.target === target);
      if (!r || r.color === color) continue;
      const note = `${this.nm(target)}への判定が${this.nm(o.by)}と食い違う(どちらかは偽物)`;
      this.judgeClaim(c, false, note, 0.35);
      this.judgeClaim(o, false, note, 0.35);
    }
  }
  private judgeClaim(c: SeerClaim, consistent: boolean, note: string, q: number) {
    c.raw *= consistent ? 1 + this.W.matchGain * q : Math.max(0.03, 1 - 0.9 * q);
    c.note = note;
    c.noteDir = consistent ? -1 : 1;
  }

  // 処刑者の白黒が判明したときの波及
  private confirmExec(target: number, color: Color, q: number) {
    if (this.confirmed.has(target)) return;
    this.confirmed.set(target, color);
    for (const c of this.seerClaims.values()) {
      // 処刑された占い師COが黒だった → 偽物確定(その人の判定は逆に読む)
      if (this.f.on('v_fake_confirmed') && c.by === target && color === 'black') {
        c.raw *= 0.02;
        c.note = `処刑された${this.nm(target)}は黒(偽占い師と判明)`;
      }
      for (const r of c.results) {
        if (r.target !== target) continue;
        // 情報量で重みづけ: 「白と言った人が白だった」はほぼ誰でも当たる(人外は少数)ので弱い証拠。
        // 黒の一致・白黒の矛盾は強い証拠
        const match = r.color === color;
        const qq = match && color === 'white' ? q * this.whiteMatchW() : q;
        this.judgeClaim(c, match, `${this.nm(target)}の判定が霊能結果と${match ? (color === 'white' ? '一致(白なので弱い根拠)' : '一致(黒)') : '矛盾'}`, qq);
        // 破綻: 黒を出した相手が霊能(定員内=ほぼ本物)で白 → その占い師は偽物で確定。吊り候補の最上位に
        if (!match && r.color === 'black' && this.mediumClaims.size <= this.counts.medium && !c.broken) {
          c.broken = true;
          c.raw = Math.min(c.raw, 0.02);
          this.add(c.by, this.W.brokenSeer, `${this.nm(target)}に黒を出したが霊能結果は白(破綻)`, 'broken');
        }
      }
    }
    const ex = this.execs.find((e) => e.target === target);
    if (!ex) return;
    // 処刑された狩人COが黒 → 対抗していた残りの狩人CO(定員内)は本物寄り
    if (color === 'black' && this.hunterClaims.has(target) && this.aliveHunterClaims() <= this.counts.hunter) {
      for (const h of this.hunterClaims) if (h !== target && h !== this.me && this.aliveNow[h]) this.add(h, this.W.hunterRivalBlack * q, `対抗の狩人CO ${this.nm(target)}が霊能で黒。残った狩人COは本物寄り`, 'hunter_gj');
    }
    const voters = this.votes.get(ex.day);
    if (color === 'black') {
      voters?.forEach((t, v) => {
        if (t === target) this.add(v, this.W.lynchBlackVoter * q, `黒の${this.nm(target)}に投票していた`);
      });
      for (const d of this.defends.get(ex.day) ?? []) if (d.target === target) this.add(d.by, this.W.defendBlack * q, `黒の${this.nm(target)}をかばっていた`, 'defend_wolf');
    } else {
      voters?.forEach((t, v) => {
        if (t === target) this.add(v, this.W.lynchWhiteVoter * q, `白の${this.nm(target)}に投票していた`, 'vote_hist');
      });
    }
  }

  // ---- 妖狐対策(村側) ----
  // 呪殺が起きた形跡があるか(朝の死体2つ、または初日の朝の死体)
  curseSeen(): boolean {
    for (const d of this.deathsByDay.keys()) if (this.curseLikely(d)) return true;
    return false;
  }
  // 残っている人狼の見込み(霊能で黒と判明した処刑者、または信頼できる占い師が黒を出して処刑された人を引く)
  wolvesLeftMax(): number {
    const dead = new Set<number>();
    for (const [t, c] of this.confirmed) if (c === 'black') dead.add(t);
    for (const c of this.seerClaims.values()) {
      // 他人の占いは信憑性が高いときだけ数える(本物の占い師も、対抗の黒を人狼として数えない。自分の黒は下で台帳から数える)
      if (c.by === this.me || this.seerTrust(c.by) < 0.6) continue;
      for (const r of c.results) if (r.color === 'black' && this.execs.some((e) => e.target === r.target)) dead.add(r.target);
    }
    if (this.usePrivate && this.selfRole === 'seer') for (const it of this.execs) if (this.ledger[it.target].some((x) => x.label.startsWith('自分の占いで黒'))) dead.add(it.target);
    return Math.max(0, this.counts.werewolf - dead.size);
  }
  // 妖狐の可能性がある人: 妖狐がいる村で呪殺の形跡がなく、信憑性の高い占い師に占われていない(占われた妖狐は死ぬ)
  foxCandidate(t: number): boolean {
    if (this.counts.fox === 0 || this.curseSeen() || !this.aliveNow[t] || t === this.me) return false;
    if (this.seerClaims.has(t) || this.mediumClaims.has(t)) return false;
    for (const c of this.seerClaims.values()) if (this.seerTrust(c.by) >= 0.5 && c.results.some((r) => r.target === t)) return false;
    if (this.usePrivate && this.selfRole === 'seer') return !this.ledger[t].some((it) => it.label.startsWith('自分の占い'));
    return true;
  }
  // 終盤の妖狐警戒: 人狼が残り1以下と見られ、吊りに余裕があるとき、最後の人狼より先に妖狐候補を吊る
  // (妖狐を残したまま人狼を全滅させると妖狐の勝ちになる)
  foxPressure(t: number): number {
    if (!this.foxCandidate(t)) return 0;
    const wl = this.wolvesLeftMax();
    if (wl > this.f.v('foxPressureWolves')) return 0;
    const margin = this.aliveCount() - 2 * wl; // 人間側の余裕(これが小さいと人狼を吊らないと負ける)
    if (margin < 3) return 0;
    return this.f.v('foxPressureW');
  }

  // 妖狐がいる村で、朝の死体が2つ(または初日の朝に死体) → どちらかは呪殺
  private curseLikely(day: number): boolean {
    if (this.counts.fox === 0) return false;
    const n = this.deathsByDay.get(day)?.length ?? 0;
    return n >= 2 || (day === 1 && n >= 1);
  }
  // 呪殺が起きた朝: その死者に白を出していた(=占っていた)占い師COは本物の可能性が高い
  private onCurse(day: number) {
    for (const t of this.deathsByDay.get(day) ?? []) this.applyCurseEvidence(t, day);
  }
  private applyCurseEvidence(dead: number, day: number) {
    for (const c of this.seerClaims.values()) {
      if (c.by === this.me) continue;
      const r = c.results.find((x) => x.target === dead && x.color === 'white' && x.day >= day - 1);
      if (r && !c.cursedCredit) {
        c.cursedCredit = true;
        c.raw *= 2.5;
        c.note = `${this.nm(dead)}を占っていて呪殺が出た(本物寄り)`;
      }
    }
  }

  private seerUnbittenNights = 0;
  // 朝: 死者が出たのに占いCOが誰も噛まれていない → 占いCOが2人以上なら全員を少しずつ疑う(本物なら噛まれる。GJの朝は判断保留)
  private checkSeerUnbitten(day: number) {
    if (!this.f.on('v_seer_unbitten')) return;
    const deaths = this.deathsByDay.get(day) ?? [];
    if (!deaths.length) return; // 平和な朝(護衛成功か)は保留
    const alive = [...this.seerClaims.values()].filter((c) => this.aliveNow[c.by] && c.by !== this.me);
    if (alive.length < 2 || deaths.some((d) => this.seerClaims.has(d))) return;
    this.seerUnbittenNights++;
    for (const c of alive) {
      if (c.fakeConfirmed || c.broken) continue;
      this.add(c.by, this.W.seerUnbitten * this.seerUnbittenNights, `占いCO${alive.length}人が${this.seerUnbittenNights}晩噛まれていない(本物なら噛まれるはず)`, 'seer_unbitten');
    }
  }
  private onAttacked(target: number) {
    const attackedIsClaimant = this.seerClaims.has(target);
    // 残る偽物の人数: 2人以上なら狼が混ざっている可能性が高くローラー対象、1人なら狂人の可能性が高い(2-1の残り)
    const remaining = attackedIsClaimant ? [...this.seerClaims.values()].filter((c) => c.by !== target && this.aliveNow[c.by] && c.by !== this.me).length : 0;
    for (const c of this.seerClaims.values()) {
      if (c.by === target) {
        c.raw *= this.f.on('v_attacked_real') ? 1.8 : 1;
        c.note = '襲撃された占い師(本物寄り)';
      } else if (attackedIsClaimant && remaining >= 2 && this.f.on('v_fake_confirmed_attack') && !c.fakeConfirmed && this.aliveNow[c.by]) {
        // 残りが1人(2-1の残り)は何もしない: 狂人の可能性が高く放置が定石。狂人が噛まれて本物が残った場合の保険にもなる
        // 本物の占い師が噛まれた → 残った占いCOは偽物(人狼か狂人)で確定。判定は逆に読む(囲いの白は黒寄り)
        c.fakeConfirmed = true;
        c.raw = Math.min(c.raw, this.W.fakeConfirmedRaw);
        c.note = `本物らしい${this.nm(target)}が噛まれた→偽物の可能性が高い`;
        c.noteDir = 1;
        this.add(c.by, this.W.fakeConfirmedComp, `占い師${this.nm(target)}が噛まれたので偽物の可能性が高い(狂人噛みの可能性は残る)`, 'fake_confirmed');
      } else if (c.results.some((r) => r.target === target && r.color === 'black')) {
        c.raw *= 0.3;
        c.note = `襲撃された${this.nm(target)}に黒を出していた(矛盾)`;
      } else if (c.results.some((r) => r.target === target && r.color === 'white')) {
        c.raw *= 1.15;
        c.note = `襲撃された${this.nm(target)}に白を出していた(一致)`;
      }
    }
  }

  private endOfDay(day: number) {
    const m = this.spoke.get(day);
    for (let p = 0; p < this.n; p++) {
      if (p === this.me || !this.aliveNow[p]) continue;
      if ((m?.get(p) ?? 0) === 0) this.add(p, this.W.silent, '今日ほぼ発言なし', 'vague');
    }
  }

  // ---- 占い師の信憑性 ----
  private rawOf(c: SeerClaim): number {
    if (this.selfRole !== 'werewolf' && c.results.some((r) => r.target === this.me && r.color === 'black')) return Math.min(c.raw, 0.02);
    return c.raw;
  }
  seerTrust(c: number): number {
    const claim = this.seerClaims.get(c);
    if (!claim) return 0;
    if (this.usePrivate && this.selfRole === 'seer') return 0; // 本物は自分
    if (this.f.on('a_viewpoint') && this.myClaim === 'seer' && c !== this.me) return 0; // 自分が占い師を名乗っている以上、対抗は(表向き)偽物。対抗の判定は信じない
    const claims = [...this.seerClaims.values()];
    const sum = claims.reduce((s, x) => s + this.rawOf(x), 0);
    let t = this.rawOf(claim) / (sum + 0.25);
    t += ((this.p.trust - 50) / 100) * 0.2 * (claims.length === 1 ? 1 : 0.5);
    return clamp(t, 0, 1);
  }

  // 役職CO者を吊り候補から外す減点(セオリー: 吊りはグレーから。役職吊りは定員超過か矛盾が出たときの最終手段)
  //  - 本物らしい占い師: 信憑性に比例(seerPenalty)
  //  - 定員内の霊能CO: 霊能騙りは稀で、吊っても狼である可能性が低い(吊り数の無駄)
  //  - 定員内の狩人CO: 吊るより噛ませたほうが村の得(人狼が吊らせたがる)
  // 「自分が霊能者」の視点か(本物、または霊能者を名乗っている)
  private mediumView(): boolean {
    return (this.usePrivate && this.selfRole === 'medium') || (this.f.on('a_viewpoint') && this.myClaim === 'medium');
  }
  rolePenalty(t: number): number {
    let p = this.seerPenalty(t);
    if (!this.f.on('v_seer_penalty')) return p;
    if (this.mediumClaims.has(t) && this.mediumClaims.size <= this.counts.medium && !this.mediumView()) p += this.W.mediumVotePenalty;
    if (this.hunterClaims.has(t) && this.aliveHunterClaims() <= this.counts.hunter && this.hunterUnbittenNights(t) === 0) p += this.W.hunterVotePenalty;
    return p;
  }
  // 本物らしい占い師を疑う/投票する候補の減点(信憑性に比例)。偽物らしい占い師には付かない
  seerPenalty(t: number): number {
    if (!this.f.on('v_seer_penalty') || !this.seerClaims.has(t)) return 0;
    const tr = this.seerTrust(t);
    return tr >= 0.3 ? this.W.seerVotePenalty * tr : 0;
  }

  private refreshSeer() {
    const nClaims = this.seerClaims.size;
    for (const c of this.seerClaims.values()) {
      if (c.by === this.me) continue;
      const t = this.seerTrust(c.by);
      const pct = Math.round(t * 100);
      // COへの疑惑(信憑性が低いほど大きい)。3人以上のCOでは1人あたり少し弱める。
      // 複数COでまだ決め手がない(信憑性が均等)うちは undecidedComp 倍(1=初日からローラー / 0=決め手が出るまで吊らない)
      const undecided = nClaims >= 2 && Math.abs(t - 1 / nClaims) < 0.12;
      // compPow>1 にすると、信憑性が高い占い師への疑いが早く消える(0.6なら (0.4)^2=0.16 倍)
      const comp = Math.pow(1 - t, this.W.compPow) * this.W.fakeSeer * (nClaims >= 3 ? 0.8 : 1) * (undecided ? this.f.v('undecidedComp') : 1);
      const diff = comp - c.fakeComp;
      if (Math.abs(diff) > 0.4 && this.aliveNow[c.by]) {
        const multi = nClaims > 1;
        // 本物は1人なので、決め手がないうちは「CO n人中 n-1 人が人外」= 1人あたり (n-1)/n の確率で人外
        const prior = Math.round(((nClaims - 1) / nClaims) * 100);
        const structural = multi ? `占い師CO${nClaims}人中の一人(本物は1人→人外の確率${prior}%、信憑性${pct}%)` : `占い師CO(信憑性${pct}%)`;
        // 直前の判定(一致/矛盾)の向きと変化の向きが合うときだけ、その判定を理由として記す
        const label = c.note && Math.sign(diff) === c.noteDir ? c.note : structural;
        this.addRaw(c.by, diff, label, multi ? 'counter_co' : 'fake_seer');
        c.fakeComp = comp;
      }
      // 判定の反映: 信憑性が低い占い師の判定は「逆」に読む(偽の黒先は白寄り、偽の白先は黒寄り)
      // 偽物確定(本物が噛まれた/破綻)の判定は逆に読む(囲いの白→黒寄り、偽の黒→白寄り)
      const eff = c.broken ? -0.5 : c.fakeConfirmed ? -this.W.fakeConfirmedReverse : this.f.on('v_reverse') ? t - this.W.fakeReverse * (1 - t) : t;
      for (const r of c.results) {
        // 白は信憑性の whitePow 乗で効かせる: 真偽不明の占い師の白(囲いの可能性)はほぼ無視し、本物と見えてきた占い師の白だけ信じる
        // eff<0(偽物確定)なら白は疑い(囲い)、黒は白寄り
        const base = r.color === 'black' ? this.W.seerBlack * eff : eff < 0 ? this.W.seerWhite * -eff : -this.W.seerWhite * Math.pow(eff, this.W.whitePow);
        const desired = this.scale(base);
        const d = desired - r.applied;
        if (Math.abs(d) > 0.4 && r.target !== this.me && this.aliveNow[r.target]) {
          const first = r.applied === 0;
          const label = first
            ? `占い師${this.nm(c.by)}の判定(${cw(r.color)}) 信憑性${pct}%`
            : `${this.nm(c.by)}の信憑性が変化→${this.nm(r.target)}への判定`;
          this.addRaw(r.target, d, label, r.color === 'black' ? 'seer_black' : undefined); // 取り消し(d<0)も同じ根拠キーで記録し、有効な根拠の合計に反映する
          r.applied = desired;
        }
      }
      c.note = undefined;
    }
  }

  // 共有者CO(定員内)は確定白として扱う。
  // ※ 霊能者COの定員超過をCO全員に分配する規則は、村側の勝率を下げたので外した(霊能ローラーで本物を吊ってしまう)
  private refreshClaims() {
    if (this.usePrivate && this.selfRole === 'mason') return;
    const over = this.masonClaims.size > this.counts.mason;
    for (const c of this.masonClaims.values()) {
      if (c.by === this.me || !this.aliveNow[c.by]) continue;
      const want = !over && this.f.on('v_mason_white') ? this.W.masonTrust : 0;
      if (Math.abs(want - c.comp) > 0.4) {
        this.add(c.by, want - c.comp, '共有者CO(定員内)');
        c.comp = want;
      }
    }
  }

  // ---- 問い合わせ ----
  aliveCount(): number {
    return this.aliveNow.filter(Boolean).length;
  }
  heat(t: number): number {
    let c = 0;
    this.stance.forEach((tg, p) => {
      if (tg === t && p !== t && this.aliveNow[p]) c++;
    });
    const denom = Math.max(1, this.aliveCount() - (t === this.me ? 1 : 2));
    return Math.min(1, c / denom);
  }
  accusersOfMe(): number {
    let c = 0;
    this.stance.forEach((tg, p) => {
      if (tg === this.me && this.aliveNow[p]) c++;
    });
    return c;
  }
  // 公開してよい根拠(その人に付いた疑惑の中で一番大きい"言える理由")
  // 根拠ごとの「現在有効な」増分(取り消しも含めた合計)で選ぶ。信憑性が落ちて黒判定が取り消された占いを根拠にしない
  publicReason(t: number): ReasonKey | undefined {
    const net = new Map<ReasonKey, number>();
    for (const it of this.ledger[t]) if (it.rk) net.set(it.rk, (net.get(it.rk) ?? 0) + it.delta);
    let best: ReasonKey | undefined;
    let bestV = 0.5;
    for (const [k, v] of net) if (v > bestV) { bestV = v; best = k; }
    return best;
  }
  topItems(t: number, k = 5): LedgerItem[] {
    return this.ledger[t]
      .filter((x) => Math.abs(x.delta) >= 0.5)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, k);
  }
}
