import { POOLS, ROLE_COSTS, type ActionCost, type ManaPool } from './costs';
import { Emitter } from './emitter';
import { AGENT_NAMES, BUILDINGS, LAYOUT, ROLES } from './lore';
import type { RealmProviders } from './providers';
import type {
  Agent,
  Approval,
  ApprovalKind,
  BriefOrder,
  BuildingId,
  ChronicleEntry,
  DayTotals,
  Design,
  Money,
  Product,
  RealmState,
  Role,
} from './types';

const SAVE_KEY = 'etsy-realm-v3';
const STATE_VERSION = 3;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Visual pacing only — how fast agents walk the roads (world units per real second). */
const WALK_SPEED = 7;
/** Visual pacing only — the shortest time an agent is shown working, even if the API answers instantly. */
const MIN_WORK_SECONDS: Record<Role, number> = { scout: 5, scribe: 3, mage: 5, warden: 3, merchant: 3, oracle: 4, herald: 2 };
/** Safety net against runaway parallelism (e.g. a typo sending 500 scouts). Not a game mechanic. */
const MAX_AGENTS_PER_ROLE = 12;

/** How often the market stats are polled (Etsy stats in real mode). */
const MARKET_POLL_MS = 5 * 60_000;
/** On reload, catch up on at most this much missed market time. */
const MAX_CATCHUP_MS = 7 * DAY_MS;
/** The seer reads the ledgers once a day on its own (or whenever asked). */
const SEER_EVERY_MS = DAY_MS;

const LISTING_FEE = 0.2;
const BRIEFS_PER_QUEST = 3;
const VARIANTS_PER_WINNER = 2;

/** Etsy transaction (6.5%) + payment processing (~3% + $0.25). Placeholder until real payouts are read. */
const etsyFee = (price: number) => price * 0.095 + 0.25;

export type RealmEvents = {
  changed: void;
  chronicle: ChronicleEntry;
  sale: { productId: string; amount: number };
  ship: { productId: string };
  raven: { ravenId: string };
  approval: Approval;
  listed: { productId: string };
  retired: { productId: string };
  dispatched: { count: number; patrol: boolean };
  mana: { pool: ManaPool; amount: number };
  manaReset: void;
  exhausted: { pool: ManaPool };
};

interface PendingCall {
  done: boolean;
  failed?: unknown;
  value?: unknown;
}

interface VisualEvent {
  at: number;
  kind: 'sale' | 'raven';
  refId: string;
  amount: number;
}

interface SeerFindings {
  retire: string[];
  variant: string[];
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const emptyMoney = (): Money => ({ revenue: 0, production: 0, etsyFees: 0, listingFees: 0, aiSpend: 0, sales: 0 });

export const netOf = (m: Money) => m.revenue - m.production - m.etsyFees - m.listingFees - m.aiSpend;

export class Realm {
  state: RealmState;
  readonly events = new Emitter<RealmEvents>();

  private pending = new Map<string, PendingCall>();
  private visuals: VisualEvent[] = [];
  /** ravens that exist but haven't visibly landed yet */
  private inFlightRavens = new Set<string>();
  private polling = false;
  private lastSave = 0;

  constructor(private providers: RealmProviders) {
    this.state = this.load() ?? this.freshState();
  }

  // ───────────────────────────── time ─────────────────────────────

  /** Local hour of day as a float (e.g. 14.5 = 14:30), drives day/night. */
  get hourOfDay(): number {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  get today(): DayTotals {
    return this.state.days[this.state.days.length - 1];
  }

  get net(): number {
    return netOf(this.state.money);
  }

  tick(realSeconds: number): void {
    const now = Date.now();
    const dt = Math.min(realSeconds, 0.25);
    this.rollDay(now);
    this.runPatrol(now);
    this.dispatchJobs();
    for (const agent of [...this.state.agents]) this.stepAgent(agent, dt, now);
    this.sendHomeExtras();
    if (now - this.state.lastMarketPollAt >= MARKET_POLL_MS) void this.pollMarket();
    this.flushVisuals(now);
    if (performance.now() - this.lastSave > 5000) this.save();
  }

  private rollDay(now: number): void {
    const key = dayKey(now);
    const s = this.state;
    if (key === s.today) return;
    // add one entry per calendar day that passed (the realm may have been closed for a while)
    let cursor = new Date(`${s.today}T12:00:00`).getTime();
    let guard = 0;
    while (dayKey(cursor) !== key && guard++ < 60) {
      cursor += DAY_MS;
      s.days.push({ day: dayKey(cursor), ...emptyMoney() });
      for (const p of s.products) {
        if (p.status !== 'listed') continue;
        p.dailySales.push(0);
        p.dailyViews.push(0);
        if (p.dailySales.length > 60) p.dailySales.shift();
        if (p.dailyViews.length > 60) p.dailyViews.shift();
      }
    }
    if (s.days.length > 60) s.days.splice(0, s.days.length - 60);
    s.today = key;
    for (const pool of Object.keys(POOLS) as ManaPool[]) s.mana[pool].spent = 0;
    for (const a of s.agents) a.resting = undefined;
    this.events.emit('manaReset', undefined);
    this.chronicle('A new day dawns. Your Ink and Arcana are restored.', 'info');
    this.changed();
  }

  // ───────────────────────────── scouts ─────────────────────────────

  /** Send `count` scouts out now. They run in parallel. */
  dispatchScouts(count: number, patrol = false): void {
    const n = Math.max(1, Math.min(MAX_AGENTS_PER_ROLE, Math.floor(count)));
    this.state.scout.pending += n;
    this.chronicle(`${patrol ? 'The patrol horn sounds: ' : ''}${n} scout${n > 1 ? 's' : ''} sent to survey the bazaar.`, 'info');
    this.events.emit('dispatched', { count: n, patrol });
    this.changed();
  }

  setPatrol(patch: Partial<RealmState['scout']['patrol']>): void {
    const p = this.state.scout.patrol;
    const wasEnabled = p.enabled;
    Object.assign(p, patch);
    p.everyMinutes = Math.max(1, Math.round(p.everyMinutes));
    p.count = Math.max(1, Math.min(MAX_AGENTS_PER_ROLE, Math.round(p.count)));
    if (!p.enabled) p.nextAt = null;
    else if (!wasEnabled || patch.everyMinutes !== undefined) p.nextAt = Date.now() + p.everyMinutes * 60_000;
    if (p.enabled !== wasEnabled) {
      this.chronicle(p.enabled ? `Scout patrols set: ${p.count} every ${formatInterval(p.everyMinutes)}.` : 'Scout patrols halted.', 'info');
    }
    this.changed();
    this.save();
  }

  setScoutOptions(patch: { focus?: string; source?: 'real' | 'simulated' }): void {
    if (patch.focus !== undefined) this.state.scout.focus = patch.focus.trim().slice(0, 80);
    if (patch.source) this.state.scout.source = patch.source;
    this.changed();
    this.save();
  }

  /** Cancel scouting trips that were ordered but haven't started (e.g. waiting for Ink). */
  cancelPendingScouts(): void {
    this.state.scout.pending = 0;
    this.changed();
  }

  private runPatrol(now: number): void {
    const p = this.state.scout.patrol;
    if (!p.enabled || p.nextAt === null || now < p.nextAt) return;
    this.dispatchScouts(p.count, true);
    // if the realm was closed through several patrols, send only one and resume the rhythm
    p.nextAt = now + p.everyMinutes * 60_000;
  }

  // ───────────────────────────── jobs & agents ─────────────────────────────

  private dispatchJobs(): void {
    for (const role of Object.keys(ROLES) as Role[]) {
      for (let guard = 0; guard < MAX_AGENTS_PER_ROLE; guard++) {
        if (!this.workAvailable(role)) {
          this.clearResting(role);
          break;
        }
        const cost = ROLE_COSTS[role];
        if (cost && !this.canAfford(cost)) {
          this.rest(role, cost.pool);
          break;
        }
        let agent = this.state.agents.find((a) => a.role === role && a.phase === 'idle');
        if (!agent) {
          if (this.state.agents.filter((a) => a.role === role).length >= MAX_AGENTS_PER_ROLE) break;
          agent = this.spawn(role);
        }
        agent.resting = undefined;
        if (!this.findWork(agent)) break;
      }
    }
  }

  /** Workers who finished go back inside; one resident per role stays at the door. */
  private sendHomeExtras(): void {
    for (const role of Object.keys(ROLES) as Role[]) {
      const idle = this.state.agents.filter((a) => a.role === role && a.phase === 'idle');
      if (idle.length <= 1) continue;
      const leaving = new Set(idle.slice(1).map((a) => a.id));
      this.state.agents = this.state.agents.filter((a) => !leaving.has(a.id));
      this.changed();
    }
  }

  private spawn(role: Role): Agent {
    const used = new Set(this.state.agents.map((a) => a.name));
    const names = AGENT_NAMES[role];
    const name = names.find((n) => !used.has(n)) ?? `${names[this.state.nextId % names.length]} the Younger`;
    const home = ROLES[role].home;
    const agent: Agent = {
      id: this.id('ag'),
      name,
      role,
      home,
      phase: 'idle',
      from: home,
      to: home,
      progress: 0,
      phaseStartedAt: Date.now(),
      activity: 'At the door',
    };
    this.state.agents.push(agent);
    return agent;
  }

  private stepAgent(agent: Agent, dt: number, now: number): void {
    switch (agent.phase) {
      case 'idle':
        return;
      case 'working': {
        const elapsed = (now - agent.phaseStartedAt) / 1000;
        const call = this.pending.get(agent.id);
        const minWork = MIN_WORK_SECONDS[agent.role];
        // progress is an estimate: it fills over the minimum time, then waits at 95% for the API
        agent.progress = call?.done ? Math.min(1, elapsed / minWork) : Math.min(0.95, elapsed / minWork);
        if (!call?.done || elapsed < minWork) return;
        this.pending.delete(agent.id);
        if (call.failed) {
          this.chronicle(`${agent.name} stumbled: ${String(call.failed)}`, 'bad');
          // a failed scouting trip is not retried automatically: send again when the problem is fixed
          if (agent.role !== 'scout') this.rollback(agent);
          this.goIdle(agent);
          return;
        }
        const target = this.completeWork(agent, call.value);
        if (target && target !== agent.home) {
          this.setPhase(agent, 'delivering', agent.home, target);
          agent.activity = `Carrying to ${BUILDINGS[target].name}`;
        } else {
          if (target) this.deliver(agent);
          this.goIdle(agent);
        }
        this.changed();
        return;
      }
      case 'delivering':
      case 'returning': {
        agent.progress = Math.min(1, agent.progress + dt / this.walkSeconds(agent.from, agent.to));
        if (agent.progress < 1) return;
        if (agent.phase === 'delivering') {
          this.deliver(agent);
          this.setPhase(agent, 'returning', agent.to, agent.home);
          agent.activity = 'Heading home';
        } else {
          this.goIdle(agent);
        }
        this.changed();
      }
    }
  }

  private setPhase(agent: Agent, phase: Agent['phase'], from: BuildingId, to: BuildingId): void {
    agent.phase = phase;
    agent.from = from;
    agent.to = to;
    agent.progress = 0;
    agent.phaseStartedAt = Date.now();
  }

  private goIdle(agent: Agent): void {
    this.setPhase(agent, 'idle', agent.home, agent.home);
    agent.activity = 'At the door';
    agent.taskRef = undefined;
    agent.cargo = undefined;
  }

  private startWork(agent: Agent, activity: string, call: () => Promise<unknown>, taskRef?: string, cargo?: unknown): boolean {
    this.setPhase(agent, 'working', agent.home, agent.home);
    agent.activity = activity;
    agent.taskRef = taskRef;
    agent.cargo = cargo === undefined ? undefined : JSON.stringify(cargo);
    const cost = ROLE_COSTS[agent.role];
    if (cost) this.spend(cost);
    const entry: PendingCall = { done: false };
    this.pending.set(agent.id, entry);
    call().then(
      (value) => {
        entry.done = true;
        entry.value = value;
      },
      (err) => {
        entry.done = true;
        entry.failed = err instanceof Error ? err.message : err;
      },
    );
    this.changed();
    return true;
  }

  private walkSeconds(a: BuildingId, b: BuildingId): number {
    const pa = LAYOUT[a];
    const pb = LAYOUT[b];
    return Math.max(1, Math.hypot(pa.x - pb.x, pa.z - pb.z) / WALK_SPEED);
  }

  /** Whether a job of this role is waiting. */
  private workAvailable(role: Role): boolean {
    const s = this.state;
    switch (role) {
      case 'scout':
        return s.scout.pending > 0;
      case 'scribe':
        return s.briefOrders.length > 0;
      case 'mage':
        return s.briefs.some((b) => b.status === 'queued');
      case 'warden':
        return s.designs.some((d) => d.status === 'queued-inspection');
      case 'merchant':
        return s.designs.some((d) => d.status === 'approved');
      case 'herald':
        return s.ravens.some((r) => r.status === 'arrived' && !this.inFlightRavens.has(r.id));
      case 'oracle': {
        const busy = s.agents.some((a) => a.role === 'oracle' && a.phase !== 'idle');
        const live = s.products.some((p) => p.status === 'listed');
        return !busy && live && (s.oracle.requested || Date.now() - s.oracle.lastAt >= SEER_EVERY_MS);
      }
    }
  }

  /** Takes one job and starts the agent on it. */
  private findWork(agent: Agent): boolean {
    const s = this.state;
    const p = this.providers;
    switch (agent.role) {
      case 'scout': {
        if (s.scout.pending <= 0) return false;
        s.scout.pending--;
        const opts = { focus: s.scout.focus, source: s.scout.source };
        const label = opts.source === 'real' ? 'Researching Etsy' : 'Surveying the bazaar (simulated)';
        return this.startWork(agent, `${label}${opts.focus ? `: ${opts.focus}` : ''}`, () => p.scoutNiche(s.quests, opts));
      }
      case 'scribe': {
        const order = s.briefOrders.shift();
        const quest = order && s.quests.find((q) => q.id === order.questId);
        if (!order || !quest) return false;
        const parent = order.parentProductId ? s.products.find((x) => x.id === order.parentProductId) : undefined;
        return this.startWork(agent, `Writing a brief for "${quest.name}"`, () => p.writeBrief(quest, parent), quest.id, order);
      }
      case 'mage': {
        const brief = s.briefs.find((b) => b.status === 'queued');
        const quest = brief && s.quests.find((q) => q.id === brief.questId);
        if (!brief || !quest) return false;
        brief.status = 'forging';
        return this.startWork(agent, `Forging "${brief.text}"`, () => p.forgeDesign(brief, quest), brief.id);
      }
      case 'warden': {
        const design = s.designs.find((d) => d.status === 'queued-inspection');
        const quest = design && s.quests.find((q) => q.id === design.questId);
        if (!design || !quest) return false;
        design.status = 'inspecting';
        return this.startWork(agent, `Inspecting "${design.title}"`, () => p.inspectDesign(design, quest), design.id);
      }
      case 'merchant': {
        const design = s.designs.find((d) => d.status === 'approved');
        const quest = design && s.quests.find((q) => q.id === design.questId);
        if (!design || !quest) return false;
        design.status = 'listing';
        return this.startWork(agent, `Opening a stall for "${design.title}"`, () => p.publishListing(design, quest), design.id);
      }
      case 'oracle': {
        s.oracle.requested = false;
        s.oracle.lastAt = Date.now();
        return this.startWork(agent, 'Reading the omens in the ledgers', async () => this.seerFindings());
      }
      case 'herald': {
        const raven = s.ravens.find((r) => r.status === 'arrived' && !this.inFlightRavens.has(r.id));
        if (!raven) return false;
        raven.status = 'drafting';
        return this.startWork(agent, `Answering ${raven.customer}`, () => p.draftReply(raven), raven.id);
      }
    }
  }

  /** Applies the result of a finished task. Returns the building the agent should carry it to. */
  private completeWork(agent: Agent, value: unknown): BuildingId | null {
    const s = this.state;
    const now = Date.now();
    switch (agent.role) {
      case 'scout': {
        const v = value as Awaited<ReturnType<RealmProviders['scoutNiche']>>;
        const quest = { ...v, id: this.id('q'), status: 'proposed' as const, briefsWritten: 0, createdAt: now };
        s.quests.push(quest);
        agent.taskRef = quest.id;
        // replace the up-front estimate with what the trip actually cost
        if (v.costUsd !== undefined) this.record('aiSpend', v.costUsd - (ROLE_COSTS.scout?.usd ?? 0));
        const evidence = v.evidence ? ` (${v.evidence.listingCount.toLocaleString()} listings on Etsy)` : '';
        this.chronicle(`${agent.name} spotted a trend: ${quest.name}${evidence}.`, 'info');
        return 'council';
      }
      case 'scribe': {
        const v = value as Awaited<ReturnType<RealmProviders['writeBrief']>>;
        const order = JSON.parse(agent.cargo ?? '{}') as BriefOrder;
        const brief = { ...v, id: this.id('b'), questId: order.questId, parentProductId: order.parentProductId, status: 'carried' as const };
        s.briefs.push(brief);
        const quest = s.quests.find((q) => q.id === order.questId);
        if (quest) {
          quest.briefsWritten++;
          const moreOrdered = s.briefOrders.some((o) => o.questId === quest.id);
          if (quest.status === 'active' && quest.briefsWritten >= BRIEFS_PER_QUEST && !moreOrdered) quest.status = 'completed';
        }
        agent.taskRef = brief.id;
        return 'magetower';
      }
      case 'mage': {
        const v = value as Awaited<ReturnType<RealmProviders['forgeDesign']>>;
        const brief = s.briefs.find((b) => b.id === agent.taskRef);
        if (!brief) return null;
        brief.status = 'forged';
        const design: Design = {
          id: this.id('d'),
          questId: brief.questId,
          briefId: brief.id,
          title: v.title,
          concept: brief.concept,
          art: v.art,
          quality: v.quality,
          risk: 'none',
          wardenNotes: '',
          status: 'carried',
          createdAt: now,
          parentProductId: brief.parentProductId,
        };
        s.designs.push(design);
        agent.taskRef = design.id;
        this.chronicle(`${agent.name} forged "${design.title}".`, 'info');
        return 'gatehouse';
      }
      case 'warden': {
        const v = value as Awaited<ReturnType<RealmProviders['inspectDesign']>>;
        const design = s.designs.find((d) => d.id === agent.taskRef);
        if (!design) return null;
        design.risk = v.risk;
        design.wardenNotes = v.notes;
        design.status = 'inspected';
        if (v.risk === 'high') this.chronicle(`${agent.name} raised an alarm over "${design.title}".`, 'bad');
        return 'council';
      }
      case 'merchant': {
        const v = value as Awaited<ReturnType<RealmProviders['publishListing']>>;
        const design = s.designs.find((d) => d.id === agent.taskRef);
        if (!design) return null;
        design.status = 'listed';
        const product: Product = {
          id: this.id('p'),
          designId: design.id,
          questId: design.questId,
          title: v.title,
          productType: v.productType,
          tags: v.tags,
          price: v.price,
          cost: v.cost,
          views: 0,
          favorites: 0,
          sales: 0,
          revenue: 0,
          profit: 0,
          dailySales: [0],
          dailyViews: [0],
          status: 'listed',
          listedAt: now,
          externalId: v.externalId,
        };
        s.products.push(product);
        this.record('listingFees', LISTING_FEE);
        this.chronicle(`A new stall opened: ${product.productType} "${design.title}" at $${product.price.toFixed(2)}.`, 'good');
        this.events.emit('listed', { productId: product.id });
        return null;
      }
      case 'oracle': {
        agent.cargo = JSON.stringify(value as SeerFindings);
        return 'council';
      }
      case 'herald': {
        const raven = s.ravens.find((r) => r.id === agent.taskRef);
        if (!raven) return null;
        raven.draftReply = value as string;
        return 'council';
      }
    }
  }

  /** The agent arrives at its target with the finished work. */
  private deliver(agent: Agent): void {
    const s = this.state;
    switch (agent.role) {
      case 'scout': {
        const quest = s.quests.find((q) => q.id === agent.taskRef);
        if (quest) this.requestApproval('quest', quest.id, `Pursue the "${quest.name}" niche?`);
        return;
      }
      case 'scribe': {
        const brief = s.briefs.find((b) => b.id === agent.taskRef);
        if (brief) brief.status = 'queued';
        return;
      }
      case 'mage': {
        const design = s.designs.find((d) => d.id === agent.taskRef);
        if (design) design.status = 'queued-inspection';
        return;
      }
      case 'warden': {
        const design = s.designs.find((d) => d.id === agent.taskRef);
        if (!design) return;
        design.status = 'awaiting';
        this.requestApproval('design', design.id, `Approve the design "${design.title}"?`);
        return;
      }
      case 'oracle': {
        const findings = JSON.parse(agent.cargo ?? '{"retire":[],"variant":[]}') as SeerFindings;
        for (const id of findings.retire) {
          const p = s.products.find((x) => x.id === id);
          if (!p || p.status !== 'listed') continue;
          p.oracleFlag = 'retire';
          this.requestApproval('retire', p.id, `Retire the failing stall "${p.title}"?`);
        }
        for (const id of findings.variant) {
          const p = s.products.find((x) => x.id === id);
          if (!p) continue;
          p.oracleFlag = 'variant';
          this.requestApproval('variant', p.id, `Make variants of the bestseller "${p.title}"?`);
        }
        if (!findings.retire.length && !findings.variant.length) this.chronicle(`${agent.name} sees no clear omens yet.`, 'info');
        return;
      }
      case 'herald': {
        const raven = s.ravens.find((r) => r.id === agent.taskRef);
        if (!raven) return;
        raven.status = 'awaiting';
        this.requestApproval('reply', raven.id, `Send the reply to ${raven.customer}?`);
        return;
      }
      case 'merchant':
        return;
    }
  }

  /** Puts reserved items back in their queues when a task is interrupted. */
  private rollback(agent: Agent): void {
    const s = this.state;
    switch (agent.role) {
      case 'scout':
        s.scout.pending++;
        return;
      case 'scribe':
        if (agent.cargo) s.briefOrders.unshift(JSON.parse(agent.cargo) as BriefOrder);
        return;
      case 'mage': {
        const brief = s.briefs.find((b) => b.id === agent.taskRef);
        if (brief) brief.status = 'queued';
        return;
      }
      case 'warden': {
        const design = s.designs.find((d) => d.id === agent.taskRef);
        if (design) design.status = 'queued-inspection';
        return;
      }
      case 'merchant': {
        const design = s.designs.find((d) => d.id === agent.taskRef);
        if (design) design.status = 'approved';
        return;
      }
      case 'herald': {
        const raven = s.ravens.find((r) => r.id === agent.taskRef);
        if (raven) raven.status = 'arrived';
        return;
      }
      case 'oracle':
        s.oracle.requested = true;
        return;
    }
  }

  private seerFindings(): SeerFindings {
    const now = Date.now();
    const live = this.state.products.filter((p) => p.status === 'listed' && !p.oracleFlag);
    const retire: string[] = [];
    const variant: string[] = [];
    for (const p of live) {
      const ageDays = (now - p.listedAt) / DAY_MS;
      const recentSales = p.dailySales.slice(-7).reduce((a, b) => a + b, 0);
      if (ageDays >= 10 && p.sales === 0) retire.push(p.id);
      else if (recentSales >= 3) variant.push(p.id);
    }
    return { retire: retire.slice(0, 3), variant: variant.slice(0, 2) };
  }

  /** Ask the seer for a reading now. */
  requestSeer(): void {
    this.state.oracle.requested = true;
    this.changed();
  }

  // ───────────────────────────── mana (AI budget) ─────────────────────────────

  /** Today's limit; Infinity when unlimited. */
  manaCap(pool: ManaPool): number {
    return this.state.mana[pool].limit ?? Infinity;
  }

  manaAvailable(pool: ManaPool): number {
    return Math.max(0, this.manaCap(pool) - this.state.mana[pool].spent);
  }

  setManaLimit(pool: ManaPool, limit: number | null): void {
    this.state.mana[pool].limit = limit === null ? null : Math.max(0, Math.round(limit));
    this.changed();
    this.save();
  }

  private canAfford(cost: ActionCost): boolean {
    return this.manaAvailable(cost.pool) >= cost.mana;
  }

  private spend(cost: ActionCost): void {
    this.state.mana[cost.pool].spent += cost.mana;
    this.record('aiSpend', cost.usd);
    this.events.emit('mana', { pool: cost.pool, amount: cost.mana });
  }

  private rest(role: Role, pool: ManaPool): void {
    const agent = this.state.agents.find((a) => a.role === role && a.phase === 'idle');
    if (agent && agent.resting !== pool) {
      agent.resting = pool;
      agent.activity = `Resting: out of ${POOLS[pool].name} until midnight`;
      this.changed();
    }
    const m = this.state.mana[pool];
    if (m.exhaustedDay !== this.state.today) {
      m.exhaustedDay = this.state.today;
      const info = POOLS[pool];
      this.chronicle(`Today's ${info.name} is spent. Agents who need it rest until midnight, or until you raise the limit.`, 'bad');
      this.events.emit('exhausted', { pool });
    }
  }

  private clearResting(role: Role): void {
    for (const a of this.state.agents) {
      if (a.role === role && a.resting) {
        a.resting = undefined;
        a.activity = 'At the door';
        this.changed();
      }
    }
  }

  // ───────────────────────────── decrees ─────────────────────────────

  private requestApproval(kind: ApprovalKind, refId: string, title: string): void {
    const approval: Approval = { id: this.id('a'), kind, refId, title, createdAt: Date.now() };
    if (this.state.trust[kind]) {
      const design = kind === 'design' ? this.state.designs.find((d) => d.id === refId) : undefined;
      this.applyDecision(approval, design ? design.risk !== 'high' : true, true);
      return;
    }
    this.state.approvals.push(approval);
    this.events.emit('approval', approval);
    this.chronicle(`A decree awaits your seal: ${title}`, 'decree');
  }

  decide(approvalId: string, approve: boolean): void {
    const idx = this.state.approvals.findIndex((a) => a.id === approvalId);
    if (idx < 0) return;
    const [approval] = this.state.approvals.splice(idx, 1);
    this.applyDecision(approval, approve, false);
    this.save();
  }

  private applyDecision(a: Approval, approve: boolean, delegated: boolean): void {
    const s = this.state;
    const by = delegated ? ' (by your delegated authority)' : '';
    switch (a.kind) {
      case 'quest': {
        const quest = s.quests.find((q) => q.id === a.refId);
        if (!quest) break;
        quest.status = approve ? 'active' : 'rejected';
        if (approve) {
          for (let i = 0; i < BRIEFS_PER_QUEST; i++) s.briefOrders.push({ questId: quest.id });
          this.chronicle(`The quest "${quest.name}" begins${by}.`, 'good');
        } else this.chronicle(`The "${quest.name}" niche was dismissed${by}.`, 'info');
        break;
      }
      case 'design': {
        const design = s.designs.find((d) => d.id === a.refId);
        if (!design) break;
        design.status = approve ? 'approved' : 'rejected';
        this.chronicle(`"${design.title}" was ${approve ? 'sealed for market' : 'cast into the fire'}${by}.`, approve ? 'good' : 'info');
        break;
      }
      case 'retire': {
        const product = s.products.find((p) => p.id === a.refId);
        if (!product) break;
        if (approve) {
          product.status = 'retired';
          void this.providers.retireListing(product);
          this.events.emit('retired', { productId: product.id });
          this.chronicle(`The stall "${product.title}" was closed${by}.`, 'info');
        } else product.oracleFlag = 'kept';
        break;
      }
      case 'variant': {
        const product = s.products.find((p) => p.id === a.refId);
        if (!product) break;
        if (approve) {
          for (let i = 0; i < VARIANTS_PER_WINNER; i++) s.briefOrders.push({ questId: product.questId, parentProductId: product.id });
          this.chronicle(`Scribes will write variants of "${product.title}"${by}.`, 'good');
        }
        break;
      }
      case 'reply': {
        const raven = s.ravens.find((r) => r.id === a.refId);
        if (!raven) break;
        raven.status = approve ? 'sent' : 'dismissed';
        if (approve) void this.providers.sendReply(raven);
        this.chronicle(`Reply to ${raven.customer} ${approve ? 'sent' : 'discarded'}${by}.`, 'info');
        break;
      }
    }
    this.changed();
  }

  setTrust(kind: ApprovalKind, value: boolean): void {
    this.state.trust[kind] = value;
    if (value) {
      for (const a of this.state.approvals.filter((x) => x.kind === kind)) {
        const design = kind === 'design' ? this.state.designs.find((d) => d.id === a.refId) : undefined;
        this.decide(a.id, design ? design.risk !== 'high' : true);
      }
    }
    this.changed();
  }

  // ───────────────────────────── market ─────────────────────────────

  /** Pull listing stats for the time since the last poll. Runs every few minutes, or on demand. */
  async pollMarket(): Promise<void> {
    if (this.polling) return;
    const s = this.state;
    const now = Date.now();
    const from = Math.max(s.lastMarketPollAt, now - MAX_CATCHUP_MS);
    s.lastMarketPollAt = now;
    const live = s.products.filter((p) => p.status === 'listed');
    if (!live.length) return;
    this.polling = true;
    try {
      const ctx = {
        questById: new Map(s.quests.map((q) => [q.id, q])),
        designById: new Map(s.designs.map((d) => [d.id, d])),
        fromMs: from,
        toMs: now,
      };
      const stats = await this.providers.marketReport(live, ctx);
      let sales = 0;
      for (const st of stats) {
        const p = s.products.find((x) => x.id === st.productId);
        if (!p) continue;
        p.views += st.views;
        p.favorites += st.favorites;
        p.dailyViews[p.dailyViews.length - 1] += st.views;
        for (let i = 0; i < st.sales; i++) {
          const fee = etsyFee(p.price);
          const profit = p.price - p.cost - fee;
          p.sales++;
          p.revenue += p.price;
          p.profit += profit;
          p.dailySales[p.dailySales.length - 1]++;
          this.record('revenue', p.price);
          this.record('production', p.cost);
          this.record('etsyFees', fee);
          this.record('sales', 1);
          // coins fly over the next minute, so a batch of sales doesn't land all at once
          this.visuals.push({ at: now + Math.random() * 60_000, kind: 'sale', refId: p.id, amount: profit });
          if (p.sales === 1) this.chronicle(`First sale of "${p.title}"!`, 'gold');
          else if (p.sales % 10 === 0) this.chronicle(`"${p.title}" has sold ${p.sales} times!`, 'gold');
          sales++;
        }
      }
      const ravens = await this.providers.pollRavens(live, { sales, windowMs: now - from });
      for (const r of ravens) {
        const raven = { ...r, id: this.id('r'), status: 'arrived' as const, at: now };
        s.ravens.push(raven);
        this.inFlightRavens.add(raven.id);
        this.visuals.push({ at: now + Math.random() * 30_000, kind: 'raven', refId: raven.id, amount: 0 });
      }
      this.visuals.sort((a, b) => a.at - b.at);
      this.changed();
    } catch (err) {
      this.chronicle(`The market ledgers could not be read: ${err instanceof Error ? err.message : String(err)}`, 'bad');
    } finally {
      this.polling = false;
    }
  }

  private flushVisuals(now: number): void {
    while (this.visuals.length && this.visuals[0].at <= now) {
      const v = this.visuals.shift()!;
      if (v.kind === 'sale') {
        this.events.emit('sale', { productId: v.refId, amount: v.amount });
        this.events.emit('ship', { productId: v.refId });
      } else {
        this.inFlightRavens.delete(v.refId);
        const raven = this.state.ravens.find((r) => r.id === v.refId);
        if (raven) {
          this.events.emit('raven', { ravenId: raven.id });
          this.chronicle(`A raven arrives from ${raven.customer}.`, 'info');
        }
      }
    }
  }

  private record(field: keyof Money, amount: number): void {
    this.state.money[field] += amount;
    this.today[field] += amount;
  }

  // ───────────────────────────── persistence ─────────────────────────────

  private freshState(): RealmState {
    const now = Date.now();
    const today = dayKey(now);
    this.state = {
      version: STATE_VERSION,
      createdAt: now,
      today,
      quests: [],
      briefs: [],
      briefOrders: [],
      designs: [],
      products: [],
      ravens: [],
      approvals: [],
      agents: [],
      chronicle: [],
      trust: { quest: false, design: false, retire: false, variant: false, reply: false },
      nextId: 1,
      money: emptyMoney(),
      days: [{ day: today, ...emptyMoney() }],
      mana: {
        ink: { spent: 0, limit: POOLS.ink.defaultLimit, exhaustedDay: '' },
        arcana: { spent: 0, limit: POOLS.arcana.defaultLimit, exhaustedDay: '' },
      },
      scout: { pending: 0, patrol: { enabled: false, everyMinutes: 120, count: 1, nextAt: null }, focus: '', source: 'real' },
      oracle: { lastAt: now, requested: false },
      lastMarketPollAt: now,
    };
    this.ensureResidents();
    this.chronicle('The realm awakens. When you are ready, send your scouts out from the Watchtower.', 'decree');
    return this.state;
  }

  private ensureResidents(): void {
    for (const role of Object.keys(ROLES) as Role[]) {
      if (!this.state.agents.some((a) => a.role === role)) this.spawn(role);
    }
  }

  save(): void {
    this.lastSave = performance.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
    } catch {
      /* storage unavailable — the realm simply won't persist */
    }
  }

  private load(): RealmState | null {
    let state: RealmState;
    try {
      localStorage.removeItem('etsy-realm-v1'); // pre-real-time saves are not compatible
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      state = JSON.parse(raw) as RealmState;
    } catch {
      return null;
    }
    if (state.version !== STATE_VERSION) return null;
    state.scout.focus ??= '';
    state.scout.source ??= 'real';
    for (const q of state.quests) q.source ??= 'simulated';
    this.state = state;
    // In-flight API calls don't survive a reload: finish deliveries, re-queue unfinished work.
    for (const agent of state.agents) {
      if (agent.phase === 'working') this.rollback(agent);
      if (agent.phase === 'delivering') this.deliver(agent);
      this.goIdle(agent);
    }
    this.sendHomeExtras();
    this.ensureResidents();
    return state;
  }

  reset(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
    location.reload();
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private id(prefix: string): string {
    return `${prefix}${this.state.nextId++}`;
  }

  chronicle(text: string, tone: ChronicleEntry['tone']): void {
    const entry: ChronicleEntry = { id: this.id('c'), at: Date.now(), text, tone };
    this.state.chronicle.push(entry);
    if (this.state.chronicle.length > 300) this.state.chronicle.shift();
    this.events.emit('chronicle', entry);
  }

  private changed(): void {
    this.events.emit('changed', undefined);
  }
}

export function formatInterval(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  if (minutes > 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
