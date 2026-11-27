import { RULE_SCALE_BY_N } from './rule-scale.gen';
import { ruleKey } from './rulekey';
import type { Color, Personality, ReasonKey, RoleId } from '../game/types';
import type { PublicEvent } from '../game/types';
import type { PlayerObservation } from '../observations/observation';
import type { Rng } from '../util/rng';
import type { Flags } from './flags';

// ============================================================================
//  Belief = how strongly each player thinks each other player is a werewolf (suspicion 0–100)
//  - Updated only from observations (PlayerObservation). Never looks at true roles.
//  - The reason for every change is kept in the ledger, so it can be reviewed afterwards via "AI思考を見る" (view AI reasoning).
// ============================================================================

// Size of each suspicion change (changing these changes the AI's habits). Unit: points.
export const W = {
  seerBlack: 58, // a seer's black result (at 100% credibility)
  seerWhite: 60, // (v18 equilibrium search: 30→60) // a seer's white result
  fakeSeer: 110, // (v18: 55→110) // suspicion attached to a seer claim in case it is fake (the lower the credibility, the more is added)
  fakeReverse: 0, // how strongly a fake claimant's results are read in reverse (a fake's black target leans white, a fake's white target leans black). Tuning found 0 best (0.35→0 gave the village side +5pt; reverse reading also gets dragged along by the madman's random results)
  silent: 3.5, // said almost nothing that day
  lateChange: 10, // declared vote and actual vote differ (common when wolves cut a mate or align votes; a strong clue: 94% of these land on werewolves)
  accuseTrusted: 4.5, // someone who accused a player I trust
  accuseConfirmedWhite: 9, // someone who accused a confirmed white (a mason, etc.)
  accuseSame: -2, // someone who accused the same player I suspect
  lynchBlackVoter: -12, // (v18: -6→-12) // someone who voted for an executed player who turned out black
  lynchWhiteVoter: 5, // someone who voted for an executed player who turned out white
  seerVotePenalty: 24, // (v18: 48→24) // how strongly a likely-real seer is kept off the accuse/execute candidates (proportional to credibility)
  defendBlack: 10, // someone who defended an executed player who turned out black
  certainBlack: 99, // black by my own divination
  certainWhite: 4, // white by my own divination
  fakeMedium: 70, // when I am the medium: another medium claim
  masonTrust: -24, // mason claim (within the seat count)
  fakeMason: 80, // when I am a mason: a mason claim by someone other than my partner
  hunterTrust: -10, // hunter claim (within the seat count)
  brokenSeer: 60, // a seer claimant whose black contradicts a within-seat-count medium result (white): a broken claim (破綻)
  hunterUnbitten: 18, // suspicion when someone died the morning after a hunter claim (= the wolves did not go to bite the hunter claimant) (× number of nights)
  hunterGj: -15, // a hunter claimant's successful-guard report matches a peaceful morning (result check passed): looks like the wolves went for a bite and the guard stopped it = leans real
  hunterGjBroken: 45, // reported a successful guard but someone died this morning (result check failed): fake
  hunterRivalBlack: -12, // the rival hunter claimant was executed and the medium result was black: the remaining within-seat-count hunter claimant leans real
  seerUnbitten: 0, // applied to every seer claimant on each morning with 2+ seer claims where none of them was bitten (× number of nights). Measured at −7pt for the village side (it executes the real seer too), so 0. Kept only as a conversation topic
  fakeConfirmedComp: 25, // suspicion on the seer claimants left (2 or more) after a likely-real seer was bitten. The bitten one may have been the madman, so this is "likely fake", not "confirmed fake"
  fakeConfirmedRaw: 0.3, // same case: cap on the remaining seer claimants' credibility (raw value) (0.03→0.3: do not treat it as confirmed; win rate unchanged)
  fakeConfirmedReverse: 0.2, // lightly reverse-read the results of a likely-fake seer (a fencing white → leans slightly black). Broken claims are handled separately and more strongly
  waverPoint: 0, // someone called out for wavering (measured no difference, so 0; conversation only)
  biteLogic: 0, // someone the bitten player had suspected (+) (measured no difference, so 0; conversation only)
  biteLogicWhite: 5, // someone the bitten player had defended (−) (75% accurate)
  silentPoint: 2, // someone called out for being silent
  coTiming: 0.08, // claim timing: credibility of the earlier seer claim ×(1+coTiming), a late claim ×(1−coTiming) // a hunter claimant survived the night without being bitten (added per night; wolves do not bite their mates)
  mediumTrust: -12, // medium claim (within the seat count). Fake medium claims are rare, so a single medium claim is treated as almost certainly real
  mediumVotePenalty: 45, // how strongly a within-seat-count medium claimant is kept off the accuse/execute candidates (executing a role claimant is a last resort)
  hunterVotePenalty: 30, // how strongly a within-seat-count hunter claimant is kept off the accuse/execute candidates
  matchGain: 0.9, // credibility gain when a seer's result matches a medium result etc. (× 1+matchGain*q)
  compPow: 2.5, // exponent in the suspicion on a seer claim, (1-credibility)^compPow (tuned: 1→2.5; clears suspicion on a seer who starts to look real sooner)
  whitePow: 2, // a seer's white result takes effect as credibility^whitePow (against fencing: don't believe whites from a seer of unknown truth)
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
  fakeConfirmed?: boolean; // confirmed fake because the real seer was bitten
  timingDone?: boolean; // whether claim timing has already been applied // confirmed broken (a black result contradicted by the medium's white)
  noteDir?: number; // direction indicated by note (-1 = credibility went up / +1 = went down). The ledger label uses note only when the direction matches
  cursedCredit?: boolean; // whether credit for a curse-kill has already been applied
  gjCredit?: boolean; // whether a hunter's successful-guard report has already been applied
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
  usePrivate: boolean; // whether to take in private information such as seer and medium results
  roleCounts: Readonly<Record<RoleId, number>>;
  rng: Rng;
  flags: Flags;
  w?: Partial<typeof W>; // overrides for the suspicion weights (W) (for measurement and tuning)
  humanSeat?: number | null; // the human's seat (to be wary based on the human's past fake-claim rate)
  humanRep?: number; // the human's past rate of fake role claims (0–1)
}

export class Belief {
  readonly me: number;
  readonly n: number;
  readonly selfRole: RoleId;
  readonly names: string[];
  private ruleScale: Record<string, number>;
  private humanSeat: number | null;
  private humanRep: number;
  // wariness based on the human player's past fake-claim rate (only once, on that player's claim)
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
  private hunterSurvived = new Map<number, number>(); // number of nights survived without being bitten since the hunter claim
  private hunterGjDay = new Set<number>(); // guard reports already result-checked (by*100+day)
  // the role I publicly claimed (real or fake). Having claimed seer, I (publicly) don't believe the rival seer's results = viewpoint consistency
  myClaim: 'seer' | 'medium' | null = null;
  // someone who has claimed any role (seer, medium, hunter, mason). Excluded from divination targets (theory: divine from the greys)
  hasClaimed(i: number): boolean {
    return this.seerClaims.has(i) || this.mediumClaims.has(i) || this.masonClaims.has(i) || this.hunterClaims.has(i);
  }
  stance = new Map<number, number>(); // each player's "latest target" today (accusation / agreement / vote declaration)
  lastAccuse: { by: number; target: number } | null = null;
  aliveNow: boolean[];
  confirmed = new Map<number, Color>(); // executed players whose white/black was revealed by the medium
  attacked = new Set<number>(); // players who died at night (bitten or curse-killed; neither is a werewolf)
  private deathsByDay = new Map<number, number[]>(); // deaths per morning (2 or more means a curse-kill is among them)
  day = 0;

  private cursor = 0;
  private seerPriv = 0;
  private medPriv = 0;
  private masonPriv = false;
  private masonMates = new Set<number>();
  private stanceDay = -1;
  private stanceByDay = new Map<number, Map<number, number>>(); // day → (player → their last target that day)
  private askedToday = new Map<number, number>(); // player who was named and asked for an opinion → that day
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
    // learned scales per player count (if there is no table for this count, use the nearest one)
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
    const sigma = 1.5 + o.personality.noise * 0.05; // spread of first impressions (kept within about ±10 even for a moody personality)
    for (let i = 0; i < o.n; i++) {
      if (i === o.me) continue;
      const imp = Math.round(o.rng.gauss() * sigma * 10) / 10;
      this.susp[i] = clamp(base + imp, 1, 99);
      this.ledger[i].push({ label: '初期値(人数比)', delta: base, day: 0 });
      if (Math.abs(imp) >= 0.1) this.ledger[i].push({ label: '第一印象(乱数)', delta: imp, day: 0 });
    }
  }

  // ---- adding to / subtracting from suspicion ----
  private scale(d: number): number {
    // aggressive players move more strongly towards suspicion, trusting players more strongly towards trust
    return d > 0 ? d * (0.6 + (this.p.aggression / 100) * 0.8) : d * (0.6 + (this.p.trust / 100) * 0.8);
  }
  private apply(i: number, d: number, label: string, rk?: ReasonKey) {
    if (this.masonMates.has(i) && this.masonPriv && d > 0 && this.susp[i] <= 1) return; // my mason partner is confirmed white; no suspicion is added
    // learned per-rule scale (estimated by logistic regression over tens of thousands of games: "how well does this rule's increment pick out werewolves")
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
  // whether confirmed white (white by my own divination, my mason partner, or a mason claimant within the seat count)
  isConfirmedWhite(i: number): boolean {
    return this.susp[i] <= 6 || (this.f.on('v_mason_white') && this.masonClaims.has(i) && this.masonClaims.size <= this.counts.mason);
  }

  // ---- taking in observations ----
  update(obs: PlayerObservation) {
    if (this.usePrivate) this.onPrivate(obs); // take in private information needed to interpret public events (e.g. my mason partner) first
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
        // a call-out from analysis: treated much like an accusation (counted in heat as naming someone). A line also applies weakly to the other party (ref)
        if (st.target != null) {
          this.stance.set(by, st.target);
          this.lastAccuse = { by, target: st.target };
          this.socialAccuse(by, st.target);
          if (st.kind === 'line' && st.ref != null && st.ref !== this.me && this.susp[st.target] > 55) this.add(st.ref, 3, `${this.nm(st.target)}とのラインを指摘された`);
        }
        break;
      case 'propose':
        // a plan proposal: counted in heat as a target for "today's execution"
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
        // calling out wavering: a conversation starter. Not used for reasoning (--rules showed zero difference between werewolves and the village side; not counted as a target either)
        if (st.target != null && this.f.on('v_waver')) this.add(st.target, this.W.waverPoint, `${this.nm(by)}にブレを指摘された`, 'vote_hist');
        break;
      case 'bite_logic':
        // bite logic: "whoever the victim defended leans white" is 75% accurate, so it is used. "whoever the victim suspected leans black" showed zero difference, so conversation only (not counted as a target either)
        if (st.target != null && this.f.on('v_bite_logic')) {
          if (st.color === 'black') this.add(st.target, this.W.biteLogic, `噛まれた${st.ref != null ? this.nm(st.ref) : '人'}が疑っていた(噛み筋)`, 'kill_contra');
          else this.add(st.target, -this.W.biteLogicWhite, `噛まれた${st.ref != null ? this.nm(st.ref) : '人'}がかばっていた(噛み筋)`);
        }
        break;
      case 'confirm':
        // a "confirmed" declaration: counting it as a target strengthens the push to execute the claimant left after the real one was bitten (a fake = wolf or madman), costing the village side −1.3pt (executing the madman wastes a day).
        // It is natural as speech so it stays, but is not used for reasoning or heat (only a confirmed broken claim counts as a target)
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
      // a white result on someone who died on a curse-kill morning → the seer who divined them is probably real
      if (color === 'white' && this.attacked.has(target) && this.curseLikely(day) && (this.deathsByDay.get(day) ?? []).includes(target)) {
        this.applyCurseEvidence(target, day);
        return;
      }
      // a result on someone whose white/black is already known is applied to credibility at once (a matching white is weak evidence)
      const known = this.knownColor(target);
      if (known) this.judgeClaim(c, known === color, `${this.nm(target)}への判定が既知の結果と${known === color ? '一致' : '矛盾'}`, known === color && color === 'white' ? this.whiteMatchW() : 1);
      // a different colour from another seer claimant on the same player → one of them is fake
      this.crossCheckSeer(c, target, color);
    }
  }
  private regMedium(by: number, day: number, target?: number, color?: Color) {
    if (!this.mediumClaims.has(by)) {
      this.mediumClaims.set(by, { by, day, comp: 0 });
      this.warnHuman(by, '霊能者');
      if (this.mediumView()) this.add(by, this.W.fakeMedium, `霊能者を名乗った(本物は私)`, 'fake_seer');
      // fake medium claims are rare (little to gain from them), so a within-seat-count medium claim is treated as almost certainly real
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
  // number of living hunter claimants (the seat count check counts only the living; claimants removed by execution or bite are not counted)
  aliveHunterClaims(): number {
    let n = 0;
    for (const h of this.hunterClaims) if (this.aliveNow[h]) n++;
    return n;
  }
  // the "result check" on the morning after a hunter claim. Standard play is for wolves to go after the hunter claimant, so the morning is read in two ways:
  //  - peaceful morning (no deaths) → looks like the wolves went for a bite and a guard stopped it. The surviving hunter claimant leans real (successful-guard result check)
  //  - someone died → the wolves did not go after the hunter claimant = possibly their mate (a werewolf). Suspicion grows with every night they go unbitten
  private checkHunterUnbitten(day: number) {
    if (!this.f.on('v_hunter_unbitten')) return;
    const peace = (this.deathsByDay.get(day) ?? []).length === 0;
    for (const h of this.hunterClaims) {
      if (!this.aliveNow[h] || h === this.me) continue;
      const cd = this.hunterClaimDay.get(h) ?? day;
      if (cd >= day) continue; // claimed only today (has not survived a night yet)
      if (peace) continue; // peaceful morning = possibly a successful guard. Don't suspect. The leans-real credit is given when the claimant's own guard report (regHunter) matches the morning
      const n = (this.hunterSurvived.get(h) ?? 0) + 1;
      this.hunterSurvived.set(h, n);
      this.add(h, this.W.hunterUnbitten * n, `狩人COなのに${n}晩噛まれていない(人狼は仲間を噛まない)`, 'fake_hunter');
    }
  }
  // number of nights a hunter claimant survived unbitten (if 0, the penalty that keeps them off the execution candidates applies)
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
    // result check of a successful-guard report: if this morning was peaceful (no deaths) and the guarded player is alive, the report matches the facts = leans real.
    // Saying "I guarded" when someone died this morning is a contradiction (fake). Standard play is for wolves to go after the hunter claimant, so a bite that was stopped looks like the real hunter
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
  // the living seer claimant with the lowest credibility
  leastTrustedClaimant(): number | null {
    let best: number | null = null;
    for (const c of this.seerClaims.values()) if (c.by !== this.me && this.aliveNow[c.by] && (best == null || this.seerTrust(c.by) < this.seerTrust(best))) best = c.by;
    return best;
  }
  // the most suspicious living player who has not claimed a role
  topGrey(): number | null {
    let best: number | null = null;
    for (let i = 0; i < this.n; i++) {
      if (i === this.me || !this.aliveNow[i] || this.seerClaims.has(i) || this.mediumClaims.has(i) || this.hunterClaims.has(i) || this.masonClaims.has(i)) continue;
      if (best == null || this.susp[i] > this.susp[best]) best = i;
    }
    return best;
  }
  // that player's number of statements (on the most recent day)
  spokeCount(p: number): number {
    const m = this.spoke.get(this.day);
    return m?.get(p) ?? 0;
  }
  // each player's last target that day (accusation / agreement / vote declaration / call-out)
  stanceOn(day: number): Map<number, number> | undefined {
    return this.stanceByDay.get(day);
  }
  // whom each player defended that day
  defendsOn(day: number): { by: number; target: number }[] {
    return this.defends.get(day) ?? [];
  }
  // whether the player was named and asked for an opinion today
  wasAsked(p: number, day: number): boolean {
    return this.askedToday.get(p) === day;
  }
  // order of the seer claim (0 = first). -1 if they have not claimed
  seerCoIndex(p: number): number {
    return [...this.seerClaims.keys()].indexOf(p);
  }
  // seer claimants who were bitten (seen as real)
  attackedSeerClaimants(): number[] {
    return [...this.seerClaims.keys()].filter((c) => this.attacked.has(c));
  }
  // yesterday's votes (public information)
  votesOn(day: number): Map<number, number> | undefined {
    return this.votes.get(day);
  }
  // yesterday's executed player
  executedOn(day: number): number | null {
    return this.execs.find((e) => e.day === day)?.target ?? null;
  }
  // players who died in the morning (of that day)
  deathsOn(day: number): number[] {
    return this.deathsByDay.get(day) ?? [];
  }
  // living players given a black by a trusted seer
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

  // colour known from public information: bitten = white, or an executed player revealed by the medium
  private knownColor(t: number): Color | null {
    if (this.attacked.has(t)) return 'white';
    return this.confirmed.get(t) ?? null;
  }
  // a white result has a high prior of being right (it is wrong only as often as non-humans occur), so a matching white is discounted accordingly
  private whiteMatchW(): number {
    const alive = Math.max(2, this.aliveCount());
    return clamp((this.counts.werewolf + this.counts.fox) / (alive - 1), 0.15, 0.5) * 1.2;
  }
  // contradiction between seers: of two who gave different colours to the same player, at least one is fake (lower both credibilities a little)
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

  // knock-on effects when an executed player's white/black becomes known
  private confirmExec(target: number, color: Color, q: number) {
    if (this.confirmed.has(target)) return;
    this.confirmed.set(target, color);
    for (const c of this.seerClaims.values()) {
      // an executed seer claimant was black → confirmed fake (their results are read in reverse)
      if (this.f.on('v_fake_confirmed') && c.by === target && color === 'black') {
        c.raw *= 0.02;
        c.note = `処刑された${this.nm(target)}は黒(偽占い師と判明)`;
      }
      for (const r of c.results) {
        if (r.target !== target) continue;
        // weighted by information content: "said white, was white" is right for almost anyone (non-humans are few), so it is weak evidence.
        // A matching black, or a white/black contradiction, is strong evidence
        const match = r.color === color;
        const qq = match && color === 'white' ? q * this.whiteMatchW() : q;
        this.judgeClaim(c, match, `${this.nm(target)}の判定が霊能結果と${match ? (color === 'white' ? '一致(白なので弱い根拠)' : '一致(黒)') : '矛盾'}`, qq);
        // broken claim: the player they gave a black was white per the medium (within seat count = almost certainly real) → that seer is confirmed fake. Top of the execution candidates
        if (!match && r.color === 'black' && this.mediumClaims.size <= this.counts.medium && !c.broken) {
          c.broken = true;
          c.raw = Math.min(c.raw, 0.02);
          this.add(c.by, this.W.brokenSeer, `${this.nm(target)}に黒を出したが霊能結果は白(破綻)`, 'broken');
        }
      }
    }
    const ex = this.execs.find((e) => e.target === target);
    if (!ex) return;
    // an executed hunter claimant was black → the remaining rival hunter claimant (within seat count) leans real
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

  // ---- countering the fox (village side) ----
  // whether there are signs of a curse-kill (two bodies in a morning, or a body on the first morning)
  curseSeen(): boolean {
    for (const d of this.deathsByDay.keys()) if (this.curseLikely(d)) return true;
    return false;
  }
  // estimate of werewolves remaining (subtract executed players revealed black by the medium, or executed players given a black by a trusted seer)
  wolvesLeftMax(): number {
    const dead = new Set<number>();
    for (const [t, c] of this.confirmed) if (c === 'black') dead.add(t);
    for (const c of this.seerClaims.values()) {
      // count other players' divinations only when credibility is high (the real seer, too, does not count a rival's blacks as werewolves; my own blacks are counted from the ledger below)
      if (c.by === this.me || this.seerTrust(c.by) < 0.6) continue;
      for (const r of c.results) if (r.color === 'black' && this.execs.some((e) => e.target === r.target)) dead.add(r.target);
    }
    if (this.usePrivate && this.selfRole === 'seer') for (const it of this.execs) if (this.ledger[it.target].some((x) => x.label.startsWith('自分の占いで黒'))) dead.add(it.target);
    return Math.max(0, this.counts.werewolf - dead.size);
  }
  // a possible fox: in a village with a fox, with no sign of a curse-kill, and not divined by a high-credibility seer (a divined fox dies)
  foxCandidate(t: number): boolean {
    if (this.counts.fox === 0 || this.curseSeen() || !this.aliveNow[t] || t === this.me) return false;
    if (this.seerClaims.has(t) || this.mediumClaims.has(t)) return false;
    for (const c of this.seerClaims.values()) if (this.seerTrust(c.by) >= 0.5 && c.results.some((r) => r.target === t)) return false;
    if (this.usePrivate && this.selfRole === 'seer') return !this.ledger[t].some((it) => it.label.startsWith('自分の占い'));
    return true;
  }
  // late-game fox caution: when at most one werewolf seems left and there are executions to spare, execute fox candidates before the last werewolf
  // (eliminating all werewolves while the fox is alive makes the fox win)
  foxPressure(t: number): number {
    if (!this.foxCandidate(t)) return 0;
    const wl = this.wolvesLeftMax();
    if (wl > this.f.v('foxPressureWolves')) return 0;
    const margin = this.aliveCount() - 2 * wl; // the human side's margin (if small, the village loses unless it executes a werewolf)
    if (margin < 3) return 0;
    return this.f.v('foxPressureW');
  }

  // in a village with a fox, two bodies in a morning (or a body on the first morning) → one of them is a curse-kill
  private curseLikely(day: number): boolean {
    if (this.counts.fox === 0) return false;
    const n = this.deathsByDay.get(day)?.length ?? 0;
    return n >= 2 || (day === 1 && n >= 1);
  }
  // on a curse-kill morning: a seer claimant who gave that dead player a white (= divined them) is likely real
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
  // morning: someone died but no seer claimant was bitten → with 2+ seer claims, suspect all of them a little (a real one would be bitten; reserve judgement on a GJ morning)
  private checkSeerUnbitten(day: number) {
    if (!this.f.on('v_seer_unbitten')) return;
    const deaths = this.deathsByDay.get(day) ?? [];
    if (!deaths.length) return; // peaceful morning (successful guard?): reserve judgement
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
    // number of fakes left: 2 or more likely includes a wolf, so they are roller targets; 1 is likely the madman (the one left of a 2-1)
    const remaining = attackedIsClaimant ? [...this.seerClaims.values()].filter((c) => c.by !== target && this.aliveNow[c.by] && c.by !== this.me).length : 0;
    for (const c of this.seerClaims.values()) {
      if (c.by === target) {
        c.raw *= this.f.on('v_attacked_real') ? 1.8 : 1;
        c.note = '襲撃された占い師(本物寄り)';
      } else if (attackedIsClaimant && remaining >= 2 && this.f.on('v_fake_confirmed_attack') && !c.fakeConfirmed && this.aliveNow[c.by]) {
        // if only one is left (the one left of a 2-1), do nothing: likely the madman, and leaving them is standard play. Also a safeguard in case the madman was bitten and the real seer remains
        // the real seer was bitten → the remaining seer claimants are confirmed fake (wolf or madman). Read their results in reverse (a fencing white leans black)
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

  // ---- seer credibility ----
  private rawOf(c: SeerClaim): number {
    if (this.selfRole !== 'werewolf' && c.results.some((r) => r.target === this.me && r.color === 'black')) return Math.min(c.raw, 0.02);
    return c.raw;
  }
  seerTrust(c: number): number {
    const claim = this.seerClaims.get(c);
    if (!claim) return 0;
    if (this.usePrivate && this.selfRole === 'seer') return 0; // I am the real one
    if (this.f.on('a_viewpoint') && this.myClaim === 'seer' && c !== this.me) return 0; // since I claim seer, the rival is (publicly) fake. Don't believe the rival's results
    const claims = [...this.seerClaims.values()];
    const sum = claims.reduce((s, x) => s + this.rawOf(x), 0);
    let t = this.rawOf(claim) / (sum + 0.25);
    t += ((this.p.trust - 50) / 100) * 0.2 * (claims.length === 1 ? 1 : 0.5);
    return clamp(t, 0, 1);
  }

  // penalty that keeps role claimants off the execution candidates (theory: execute from the greys; executing a role claimant is a last resort when claims exceed the seat count or a contradiction appears)
  //  - a likely-real seer: proportional to credibility (seerPenalty)
  //  - a within-seat-count medium claimant: fake medium claims are rare, so executing one is unlikely to hit a wolf (a wasted execution)
  //  - a within-seat-count hunter claimant: better for the village to let the wolves bite them than to execute them (the wolves want them executed)
  // whether reasoning from the "I am the medium" viewpoint (real, or claiming medium)
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
  // penalty on accusing/voting for a likely-real seer (proportional to credibility). Not applied to a likely-fake seer
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
      // suspicion on the claim (larger the lower the credibility). With 3+ claims it is weakened a little per claimant.
      // While there are multiple claims and no decisive evidence yet (credibility even), multiply by undecidedComp (1 = roller from day one / 0 = don't execute until decisive evidence appears)
      const undecided = nClaims >= 2 && Math.abs(t - 1 / nClaims) < 0.12;
      // with compPow>1, suspicion on a high-credibility seer fades faster (at 0.6: (0.4)^2 = ×0.16)
      const comp = Math.pow(1 - t, this.W.compPow) * this.W.fakeSeer * (nClaims >= 3 ? 0.8 : 1) * (undecided ? this.f.v('undecidedComp') : 1);
      const diff = comp - c.fakeComp;
      if (Math.abs(diff) > 0.4 && this.aliveNow[c.by]) {
        const multi = nClaims > 1;
        // only one is real, so without decisive evidence "n-1 of the n claimants are non-human" = each is non-human with probability (n-1)/n
        const prior = Math.round(((nClaims - 1) / nClaims) * 100);
        const structural = multi ? `占い師CO${nClaims}人中の一人(本物は1人→人外の確率${prior}%、信憑性${pct}%)` : `占い師CO(信憑性${pct}%)`;
        // record the latest judgement (match/contradiction) as the reason only when its direction matches the direction of the change
        const label = c.note && Math.sign(diff) === c.noteDir ? c.note : structural;
        this.addRaw(c.by, diff, label, multi ? 'counter_co' : 'fake_seer');
        c.fakeComp = comp;
      }
      // applying results: a low-credibility seer's results are read "in reverse" (a fake's black target leans white, a fake's white target leans black)
      // results of a confirmed fake (real seer bitten / broken claim) are read in reverse (fencing white → leans black, fake black → leans white)
      const eff = c.broken ? -0.5 : c.fakeConfirmed ? -this.W.fakeConfirmedReverse : this.f.on('v_reverse') ? t - this.W.fakeReverse * (1 - t) : t;
      for (const r of c.results) {
        // a white takes effect as credibility to the power whitePow: whites from a seer of unknown truth (possible fencing) are almost ignored; only whites from a seer who is starting to look real are believed
        // if eff<0 (confirmed fake), a white means suspicion (fencing) and a black leans white
        const base = r.color === 'black' ? this.W.seerBlack * eff : eff < 0 ? this.W.seerWhite * -eff : -this.W.seerWhite * Math.pow(eff, this.W.whitePow);
        const desired = this.scale(base);
        const d = desired - r.applied;
        if (Math.abs(d) > 0.4 && r.target !== this.me && this.aliveNow[r.target]) {
          const first = r.applied === 0;
          const label = first
            ? `占い師${this.nm(c.by)}の判定(${cw(r.color)}) 信憑性${pct}%`
            : `${this.nm(c.by)}の信憑性が変化→${this.nm(r.target)}への判定`;
          this.addRaw(r.target, d, label, r.color === 'black' ? 'seer_black' : undefined); // a retraction (d<0) is recorded under the same reason key, so it is reflected in the net total of valid reasons
          r.applied = desired;
        }
      }
      c.note = undefined;
    }
  }

  // a mason claim (within the seat count) is treated as confirmed white.
  // Note: the rule that spread suspicion over all medium claimants when they exceeded the seat count was removed because it lowered the village win rate (a medium roller executes the real one)
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

  // ---- queries ----
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
  // a reason that may be stated publicly (the largest "sayable reason" among the suspicion attached to that player)
  // chosen by each reason's "currently valid" increment (net of retractions). A divination whose black was retracted after credibility fell is not used as a reason
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
