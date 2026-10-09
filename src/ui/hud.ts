import { designDataUrl } from '../engine/art';
import { POOLS, ROLE_COSTS, type ManaPool } from '../engine/costs';
import { BUILDINGS, ROLES } from '../engine/lore';
import { formatInterval, netOf, type Realm } from '../engine/realm';
import type { Approval, ApprovalKind, BuildingId, ChronicleEntry, Design, Money, Product, Quest, QuestEvidence, Role } from '../engine/types';
import type { World } from '../world/world';

const ROLE_ICON: Record<Role, string> = {
  scout: '🏹', scribe: '🪶', mage: '✨', warden: '🛡️', merchant: '⚖️', oracle: '🔮', herald: '🐦‍⬛',
};
const KIND_LABEL: Record<ApprovalKind, string> = {
  quest: 'New quests',
  design: 'Designs',
  retire: 'Closing stalls',
  variant: 'Variants',
  reply: 'Raven replies',
};
const ROLE_FOR_BUILDING: Partial<Record<BuildingId, Role>> = Object.fromEntries(
  (Object.keys(ROLES) as Role[]).map((r) => [ROLES[r].home, r]),
);
const UNITS = { minutes: 1, hours: 60, days: 1440 } as const;
type Unit = keyof typeof UNITS;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isToday = (ms: number) => new Date(ms).toDateString() === new Date().toDateString();
const when = (ms: number) => (isToday(ms) ? clock(ms) : `${new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${clock(ms)}`);

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function until(ms: number): string {
  const s = Math.max(0, (ms - Date.now()) / 1000);
  if (s < 60) return `${Math.ceil(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function splitInterval(minutes: number): { value: number; unit: Unit } {
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

interface ApiStatus {
  scout: { real: boolean; etsy: string; claude: string; etsyRemainingToday: number | null; etsyLimitPerDay: number | null };
}

export class Hud {
  private el = {
    top: byId('topbar'),
    roster: byId('roster'),
    decrees: byId('decrees'),
    chronicle: byId('chronicle-list'),
    inspector: byId('inspector'),
    ledger: byId('ledger'),
    toasts: byId('toasts'),
  };
  private decreeSig = '';
  private ledgerOpen = false;
  private ledgerSort: keyof Product = 'sales';
  private lastRender = 0;
  /** how many scouts the "Send now" button sends */
  private sendCount = 1;
  /** what the local server reports about real providers; null = server unreachable */
  private api: ApiStatus | null = null;

  constructor(private realm: Realm, private world: World) {
    world.onSelect = () => this.renderInspector(true);
    realm.events.on('chronicle', (e) => this.appendChronicle(e));
    realm.events.on('approval', (a) => this.toast(`📜 ${a.title}`, 'decree'));
    realm.events.on('exhausted', ({ pool }) => this.toast(`${POOLS[pool].icon} Today's ${POOLS[pool].name} is spent. Agents who need it are resting.`, 'bad'));
    realm.events.on('dispatched', ({ count, patrol }) => this.toast(`📯 ${count} scout${count > 1 ? 's' : ''} ${patrol ? 'left on patrol' : 'sent out'}`, 'good'));
    realm.events.on('approval', (a) => a.kind === 'quest' && void this.refreshStatus());
    for (const e of realm.state.chronicle.slice(-60)) this.appendChronicle(e);
    void this.refreshStatus();
    setInterval(() => void this.refreshStatus(), 60_000);
    this.bind();
    this.renderAll();
  }

  private async refreshStatus(): Promise<void> {
    try {
      const res = await fetch('/api/status');
      this.api = res.ok ? ((await res.json()) as ApiStatus) : null;
    } catch {
      this.api = null;
    }
  }

  update(): void {
    const now = performance.now();
    if (now - this.lastRender < 250) return;
    this.lastRender = now;
    this.renderAll();
  }

  private renderAll(): void {
    this.renderTop();
    this.renderRoster();
    this.renderDecrees();
    this.renderInspector();
    if (this.ledgerOpen) this.renderLedger();
  }

  // ───────────────────────────── top bar ─────────────────────────────

  private renderTop(): void {
    const s = this.realm.state;
    const hour = this.realm.hourOfDay;
    const isNight = hour < 6 || hour >= 20;
    const t = this.realm.today;
    const net = this.realm.net;
    const costsToday = t.production + t.etsyFees + t.listingFees + t.aiSpend;
    const live = s.products.filter((p) => p.status === 'listed').length;
    setHtml(this.el.top, `
      <div class="crest">⚜ <span>The Steward's Realm</span></div>
      <div class="clock">${isNight ? '🌙' : '☀️'} ${new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${clock(Date.now())}</div>
      <button class="stat gold ${net < 0 ? 'neg' : ''}" data-action="select-building" data-id="treasury" title="Net: revenue minus production, Etsy fees, listing fees and AI spend">🪙 ${usd(net)}</button>
      <div class="stat" title="Today: revenue / all costs">📈 +${usd(t.revenue)} <span class="dim">/ −${usd(costsToday)}</span> today</div>
      ${(Object.keys(POOLS) as ManaPool[]).map((pool) => this.manaPill(pool)).join('')}
      <div class="stat" title="Live listings">🎪 ${live}</div>
      <button class="btn" data-action="ledger">📖 Ledger</button>
      <button class="btn ghost" data-action="help" title="How to play">?</button>
    `);
  }

  private manaPill(pool: ManaPool): string {
    const info = POOLS[pool];
    const m = this.realm.state.mana[pool];
    const avail = this.realm.manaAvailable(pool);
    const unlimited = m.limit === null;
    const frac = unlimited ? 1 : m.limit ? avail / m.limit : 0;
    return `
      <button class="mana-pill ${pool} ${frac === 0 ? 'empty' : frac < 0.25 ? 'low' : ''}" data-action="select-building" data-id="${info.building}" title="${info.name}: ${info.meaning}. Your daily limit, resets at midnight.">
        <span>${info.icon} ${m.spent} / ${unlimited ? '∞' : m.limit}</span><span class="bar"><i style="width:${pct(unlimited ? 0 : 1 - frac)}"></i></span>
      </button>`;
  }

  // ───────────────────────────── roster ─────────────────────────────

  private renderRoster(): void {
    const s = this.realm.state;
    const sel = this.world.selection;
    const html = (Object.keys(ROLES) as Role[])
      .map((role) => {
        const info = ROLES[role];
        const members = s.agents.filter((a) => a.role === role);
        const busy = members.filter((a) => a.phase !== 'idle').length;
        const waiting = role === 'scout' ? s.scout.pending : 0;
        const rows = members
          .map((a) => `
            <div class="agent ${a.phase} ${a.resting ? 'resting' : ''} ${sel?.type === 'agent' && sel.id === a.id ? 'selected' : ''}" data-action="select-agent" data-id="${a.id}">
              <div class="agent-head"><b>${esc(a.name)}</b></div>
              <div class="agent-act">${esc(a.activity)}</div>
              <div class="bar"><i style="width:${a.phase === 'working' ? Math.round(a.progress * 100) : a.phase === 'idle' ? 0 : Math.round(a.progress * 100)}%"></i></div>
            </div>`)
          .join('');
        const scoutBtn = role === 'scout' ? `<button class="hire" data-action="send-scouts" data-count="1" title="Send one scout now">📯 Send</button>` : '';
        return `
          <section class="role">
            <header>
              <span data-action="select-building" data-id="${info.home}" class="role-name">${ROLE_ICON[role]} ${info.title}s <small>${busy ? `${busy} at work` : 'idle'}${waiting ? ` · ${waiting} waiting` : ''}</small></span>
              ${scoutBtn}
            </header>
            ${rows}
          </section>`;
      })
      .join('');
    setHtml(this.el.roster, `<h2>The Fellowship</h2>${html}`);
  }

  // ───────────────────────────── decrees ─────────────────────────────

  private renderDecrees(): void {
    const s = this.realm.state;
    const sig = s.approvals.map((a) => a.id).join(',') + JSON.stringify(s.trust);
    if (sig === this.decreeSig) return;
    this.decreeSig = sig;
    const trust = (Object.keys(KIND_LABEL) as ApprovalKind[])
      .map((k) => `<label class="trust"><input type="checkbox" data-action="trust" data-kind="${k}" ${s.trust[k] ? 'checked' : ''}/> ${KIND_LABEL[k]}</label>`)
      .join('');
    const cards = s.approvals.length
      ? s.approvals.map((a) => this.decreeCard(a)).join('')
      : `<div class="empty">No decrees await your seal.</div>`;
    this.el.decrees.innerHTML = `
      <h2>Decrees <small>${s.approvals.length || ''}</small></h2>
      <details class="authority">
        <summary>Delegate authority</summary>
        <p>The council will seal these without asking you. Designs the warden marks as high risk are always rejected.</p>
        ${trust}
      </details>
      <div class="cards">${cards}</div>
      ${s.approvals.length > 1 ? `<div class="bulk"><button class="btn" data-action="approve-all">Seal all</button></div>` : ''}
    `;
  }

  private decreeCard(a: Approval): string {
    const s = this.realm.state;
    const actions = (yes = 'Seal', no = 'Reject') => `
      <div class="actions">
        <button class="btn yes" data-action="decide" data-id="${a.id}" data-value="1">✔ ${yes}</button>
        <button class="btn no" data-action="decide" data-id="${a.id}" data-value="0">✖ ${no}</button>
      </div>`;
    switch (a.kind) {
      case 'quest': {
        const q = s.quests.find((x) => x.id === a.refId);
        if (!q) return '';
        const e = q.evidence;
        return `
          <article class="card quest">
            <div class="kind">🏹 New quest · scouted ${when(q.createdAt)} · <span class="src ${q.source}">${q.source === 'etsy' ? 'real Etsy data' : 'simulated'}</span></div>
            <h3>${q.emoji ? `${q.emoji} ` : ''}${esc(q.name)}</h3>
            <p class="lore">"${esc(q.rationale)}"</p>
            ${meter('Demand', q.demand, 'good')}
            ${meter('Competition', q.competition, 'bad')}
            ${meter('Opportunity', Math.min(1, q.demand * (1 - q.competition) * 2.5), 'gold')}
            ${e ? evidenceBlock(e, q.costUsd) : `<div class="muted">Typical price ~${usd(q.avgPrice)}</div>`}
            <div class="chips">${q.keywords.map((k) => `<span>${esc(k)}</span>`).join('')}</div>
            ${actions('Embark', 'Dismiss')}
          </article>`;
      }
      case 'design': {
        const d = s.designs.find((x) => x.id === a.refId);
        if (!d) return '';
        const q = s.quests.find((x) => x.id === d.questId);
        return `
          <article class="card design risk-${d.risk}">
            <div class="kind">✨ Design · ${esc(q?.name ?? '')}${d.parentProductId ? ' · variant' : ''}</div>
            <img src="${designDataUrl(d.art, q?.emoji ?? q?.theme ?? '')}" alt="" data-action="zoom" data-id="${d.id}"/>
            <h3>${esc(d.title)}</h3>
            <p class="muted">${esc(d.concept)}</p>
            <div class="warden"><span class="risk">${riskLabel(d.risk)}</span> ${esc(d.wardenNotes)}</div>
            ${actions('Send to market', 'Burn it')}
          </article>`;
      }
      case 'retire':
      case 'variant': {
        const p = s.products.find((x) => x.id === a.refId);
        if (!p) return '';
        const d = s.designs.find((x) => x.id === p.designId);
        const q = s.quests.find((x) => x.id === p.questId);
        const week = p.dailySales.slice(-7).reduce((x, y) => x + y, 0);
        const retire = a.kind === 'retire';
        return `
          <article class="card ${a.kind}">
            <div class="kind">🔮 The seer advises · ${retire ? 'close this stall' : 'make variants'}</div>
            <div class="row">
              ${d ? `<img class="thumb" src="${designDataUrl(d.art, q?.emoji ?? q?.theme ?? '')}" alt=""/>` : ''}
              <div>
                <h3>${esc(p.title)}</h3>
                <div class="muted">listed ${ago(p.listedAt)} · ${p.views} views · ${p.sales} sales · ${week} this week</div>
              </div>
            </div>
            <p class="lore">${retire ? '"No buyer has come for this ware. Its stall would serve us better empty."' : '"This ware is in demand. Kin of it would sell well too."'}</p>
            ${retire ? actions('Close stall', 'Keep it') : actions('Forge variants', 'Not now')}
          </article>`;
      }
      case 'reply': {
        const r = s.ravens.find((x) => x.id === a.refId);
        if (!r) return '';
        const p = r.productId ? s.products.find((x) => x.id === r.productId) : undefined;
        return `
          <article class="card reply">
            <div class="kind">🐦‍⬛ Raven from ${esc(r.customer)}</div>
            ${p ? `<div class="muted">About: ${esc(p.title)}</div>` : ''}
            <blockquote>${esc(r.message)}</blockquote>
            <label class="muted">The herald's draft (you may edit it):</label>
            <textarea data-raven="${r.id}">${esc(r.draftReply ?? '')}</textarea>
            ${actions('Send', 'Discard')}
          </article>`;
      }
    }
  }

  // ───────────────────────────── inspector ─────────────────────────────

  private renderInspector(force = false): void {
    // don't rebuild while the Steward is typing in one of the inspector's fields
    const active = document.activeElement;
    if (!force && active && this.el.inspector.contains(active) && active.matches('input, select, textarea')) return;
    const sel = this.world.selection;
    if (!sel) {
      this.el.inspector.classList.remove('open');
      return;
    }
    const html = sel.type === 'building' ? this.buildingCard(sel.id) : sel.type === 'agent' ? this.agentCard(sel.id) : this.productCard(sel.id);
    if (!html) {
      this.world.select(null, false);
      return;
    }
    this.el.inspector.classList.add('open');
    setHtml(this.el.inspector, `<button class="close" data-action="deselect">×</button>${html}`);
    this.drawCharts();
  }

  private buildingCard(id: BuildingId): string {
    const s = this.realm.state;
    const info = BUILDINGS[id];
    const role = ROLE_FOR_BUILDING[id];
    const stationed = s.agents.filter((a) => a.home === id);
    const pool = (Object.keys(POOLS) as ManaPool[]).find((p) => POOLS[p].building === id);
    let body = '';
    switch (id) {
      case 'watchtower':
        body = this.scoutPanel();
        break;
      case 'treasury':
        body = this.moneyPanel();
        break;
      case 'oracle': {
        const next = s.oracle.lastAt + 86_400_000;
        body = `
          <p>Last reading ${ago(s.oracle.lastAt)}. The next one is due ${next <= Date.now() ? 'now' : `in ${until(next)}`}, if there are live stalls.</p>
          <p class="muted">The seer flags stalls with no sales after 10 days, and stalls with 3+ sales in the last 7 days.</p>
          <div class="actions"><button class="btn" data-action="consult-seer" ${s.oracle.requested ? 'disabled' : ''}>🔮 ${s.oracle.requested ? 'Reading requested' : 'Consult now'}</button></div>`;
        break;
      }
      case 'market':
        body = `
          <p>${s.products.filter((p) => p.status === 'listed').length} live stalls · ${s.designs.filter((d) => d.status === 'approved').length} approved designs waiting to be listed.</p>
          <p class="muted">Sales and views are polled every 5 minutes. Last checked ${ago(s.lastMarketPollAt)}.</p>
          <div class="actions"><button class="btn" data-action="poll-market">🔄 Check the market now</button></div>`;
        break;
      case 'council':
        body = `<p>${s.approvals.length} decrees await your seal.</p><div class="actions"><button class="btn ghost" data-action="ledger">📖 Open ledger</button></div>`;
        break;
      case 'scriptorium':
        body = `<p>${s.briefOrders.length} briefs ordered.</p>`;
        break;
      case 'magetower':
        body = `<p>${s.briefs.filter((b) => b.status === 'queued').length} briefs waiting to be forged.</p>`;
        break;
      case 'gatehouse':
        body = `<p>${s.designs.filter((d) => d.status === 'queued-inspection').length} designs waiting for inspection.</p>`;
        break;
      case 'rookery':
        body = `<p>${s.ravens.filter((r) => r.status === 'arrived').length} ravens unanswered · ${s.ravens.filter((r) => r.status === 'sent').length} replies sent.</p>`;
        break;
    }
    return `
      <div class="kind">${role ? `${ROLE_ICON[role]} Home of the ${ROLES[role].title}s` : 'Seat of the realm'}</div>
      <h3>${info.name}</h3>
      <p class="lore">${info.description}</p>
      ${body}
      ${pool ? this.manaSection(pool) : ''}
      ${stationed.length ? `<div class="muted">Here now: ${stationed.map((a) => `<a data-action="select-agent" data-id="${a.id}">${esc(a.name)}</a>`).join(', ')}</div>` : ''}`;
  }

  /** The Watchtower: send scouts now, or set a patrol. */
  private scoutPanel(): string {
    const s = this.realm.state;
    const cost = ROLE_COSTS.scout!;
    const out = s.agents.filter((a) => a.role === 'scout' && a.phase !== 'idle').length;
    const patrol = s.scout.patrol;
    const { value, unit } = splitInterval(patrol.everyMinutes);
    const n = this.sendCount;
    const recent = s.quests.slice(-5).reverse();
    const real = s.scout.source === 'real';
    const st = this.api?.scout;
    const ready = real && !!st?.real;
    const sourceInfo = !real
      ? '<div class="muted">The scouts make up their findings. Nothing real is called.</div>'
      : !this.api
        ? '<div class="warn">The local scout server is unreachable. Run <code>npm run dev</code>.</div>'
        : st!.real
          ? `<div class="muted ok">✔ Etsy API · ✔ Claude (${esc(st!.claude)})${st!.etsyRemainingToday !== null ? ` · Etsy quota ${st!.etsyRemainingToday.toLocaleString()}${st!.etsyLimitPerDay ? ` / ${st!.etsyLimitPerDay.toLocaleString()}` : ''} left today` : ''}</div>`
          : `<div class="warn">Not set up yet: Etsy ${esc(st!.etsy)} · Claude ${esc(st!.claude)}.<br/>Copy <code>.env.example</code> to <code>.env.local</code>, add your keys, then restart <code>npm run dev</code>.</div>`;
    return `
      <div class="dispatch">
        <div class="kind">🔭 What the scouts use</div>
        <label class="radio"><input type="radio" name="scout-source" value="real" data-action="scout-source" ${real ? 'checked' : ''}/> Real data: Claude + the Etsy API</label>
        <label class="radio"><input type="radio" name="scout-source" value="simulated" data-action="scout-source" ${real ? '' : 'checked'}/> Simulated</label>
        ${sourceInfo}
        <label class="focus">Focus <input type="text" data-action="scout-focus" value="${esc(s.scout.focus)}" placeholder="optional: halloween, cats, teachers…"/></label>
      </div>
      <div class="dispatch">
        <div class="kind">📯 Send scouts now</div>
        <div class="send-row">
          <button class="step" data-action="send-count" data-delta="-1">−</button>
          <input type="number" min="1" max="12" value="${n}" data-action="send-count-input"/>
          <button class="step" data-action="send-count" data-delta="1">+</button>
          <button class="btn yes" data-action="send-scouts" data-count="${n}" ${real && !ready ? 'disabled title="Set up the real data source first, or switch to Simulated"' : ''}>Send ${n} scout${n > 1 ? 's' : ''}</button>
        </div>
        <div class="muted">They all ride out at once. Cost: ${n * cost.mana} ${POOLS[cost.pool].icon} ≈ ${usd(n * cost.usd)}${real ? ' estimated. Each trip reports its exact cost when it returns' : ''}.${real ? ` Each trip makes 2 Claude calls and ~${5 + 2 * 8} Etsy calls.` : ''}</div>
        <div class="status-row">
          <span>🏹 <b>${out}</b> out now</span>
          <span>⏳ <b>${s.scout.pending}</b> waiting to leave${s.scout.pending ? ` <a data-action="cancel-scouts">cancel</a>` : ''}</span>
        </div>
        ${s.scout.pending && this.realm.manaAvailable(cost.pool) < cost.mana ? `<div class="warn">Waiting for ${POOLS[cost.pool].name}. Raise today's limit below to let them go.</div>` : ''}
      </div>
      <div class="dispatch">
        <div class="kind">🔁 Patrol</div>
        <label class="patrol-toggle"><input type="checkbox" data-action="patrol-enabled" ${patrol.enabled ? 'checked' : ''}/> Send scouts on a schedule</label>
        <div class="patrol-row">
          Every <input type="number" min="1" value="${value}" data-action="patrol-every"/>
          <select data-action="patrol-unit">${(Object.keys(UNITS) as Unit[]).map((u) => `<option value="${u}" ${u === unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
          send <input type="number" min="1" max="12" value="${patrol.count}" data-action="patrol-count"/> scout${patrol.count > 1 ? 's' : ''}
        </div>
        <div class="muted">${patrol.enabled && patrol.nextAt ? `Next patrol in <b>${until(patrol.nextAt)}</b> (${when(patrol.nextAt)}). Up to ${usd(patrol.count * cost.usd * (1440 / patrol.everyMinutes))} per day.` : `Off. When on: ${patrol.count} every ${formatInterval(patrol.everyMinutes)}.`}</div>
      </div>
      ${recent.length ? `<div class="kind" style="margin-top:8px">Recent findings</div>${recent.map((q) => `<div class="mini"><b>${esc(q.name)}</b> <span class="tag ${q.status}">${q.status}</span> <small>${ago(q.createdAt)}</small> ${questStats(q, s.products)}</div>`).join('')}` : ''}`;
  }

  private moneyPanel(): string {
    const s = this.realm.state;
    const rows = (m: Money) => `
      <span>Revenue</span><b>${usd(m.revenue)}</b>
      <span>Production (print partner)</span><b>−${usd(m.production)}</b>
      <span>Etsy fees</span><b>−${usd(m.etsyFees)}</b>
      <span>Listing fees</span><b>−${usd(m.listingFees)}</b>
      <span>AI spend</span><b>−${usd(m.aiSpend)}</b>
      <span><b>Net</b></span><b class="${netOf(m) < 0 ? 'warn' : 'goldtxt'}">${usd(netOf(m))}</b>`;
    return `
      <div class="money-cols">
        <div><div class="kind">Today</div><div class="grid">${rows(this.realm.today)}</div></div>
        <div><div class="kind">All time</div><div class="grid">${rows(s.money)}</div></div>
      </div>
      <canvas class="chart" width="360" height="90" data-chart="net"></canvas>
      <p class="muted">Fees and AI costs are estimates until real Etsy payouts and provider bills are connected.</p>`;
  }

  private manaSection(pool: ManaPool): string {
    const info = POOLS[pool];
    const m = this.realm.state.mana[pool];
    const unlimited = m.limit === null;
    const costs = (Object.entries(ROLE_COSTS) as [Role, NonNullable<(typeof ROLE_COSTS)[Role]>][])
      .filter(([, c]) => c.pool === pool)
      .map(([role, c]) => `<tr><td>${ROLE_ICON[role]} ${c.label}</td><td>${c.mana} ${info.icon}</td><td>~${usd(c.usd)}</td></tr>`)
      .join('');
    const resting = this.realm.state.agents.filter((a) => a.resting === pool).length;
    return `
      <div class="mana-box ${pool}">
        <div class="kind">${info.icon} ${info.name} · your daily AI budget</div>
        <div class="muted">${info.meaning}</div>
        <div class="mana-gauge"><div class="bar"><i style="width:${unlimited ? '0%' : pct(Math.min(1, m.spent / Math.max(1, m.limit!)))}"></i></div><b>${m.spent} / ${unlimited ? '∞' : m.limit} used</b></div>
        ${resting ? `<div class="warn">${resting} agent${resting > 1 ? 's' : ''} resting until the limit allows more.</div>` : ''}
        <div class="limit-row">
          Daily limit <input type="number" min="0" value="${unlimited ? '' : m.limit}" placeholder="∞" data-action="mana-limit" data-pool="${pool}" ${unlimited ? 'disabled' : ''}/>
          <label><input type="checkbox" data-action="mana-unlimited" data-pool="${pool}" ${unlimited ? 'checked' : ''}/> unlimited</label>
        </div>
        <table class="costs"><thead><tr><th>Task</th><th>Mana</th><th>Est. cost</th></tr></thead><tbody>${costs}</tbody></table>
        <div class="muted">Resets at midnight. Costs are placeholder estimates. Set them from real pricing when providers are connected.</div>
      </div>`;
  }

  private agentCard(id: string): string {
    const a = this.realm.state.agents.find((x) => x.id === id);
    if (!a) return '';
    const info = ROLES[a.role];
    const resident = this.realm.state.agents.find((x) => x.role === a.role)?.id === a.id;
    return `
      <div class="kind">${ROLE_ICON[a.role]} ${info.title}${resident ? ' · resident' : ' · on a job'}</div>
      <h3>${esc(a.name)}</h3>
      <p class="lore">${info.description}</p>
      <p><b>Now:</b> ${esc(a.activity)}${a.phase !== 'idle' ? ` <small class="muted">(since ${clock(a.phaseStartedAt)})</small>` : ''}</p>
      ${a.phase !== 'idle' ? `<div class="bar big"><i style="width:${Math.round(a.progress * 100)}%"></i></div>` : ''}
      <div class="muted">${resident ? 'Waits at the door of' : 'Goes back inside'} ${BUILDINGS[a.home].name}${resident ? '' : ' when the job is done'}.</div>
      <div class="actions"><button class="btn ghost" data-action="select-building" data-id="${a.home}">Go to ${BUILDINGS[a.home].name}</button></div>`;
  }

  private productCard(id: string): string {
    const s = this.realm.state;
    const p = s.products.find((x) => x.id === id);
    if (!p) return '';
    const d = s.designs.find((x) => x.id === p.designId);
    const q = s.quests.find((x) => x.id === p.questId);
    return `
      <div class="kind">🎪 ${p.productType} · ${esc(q?.name ?? '')}</div>
      <div class="row">
        ${d ? `<img class="thumb big" src="${designDataUrl(d.art, q?.emoji ?? q?.theme ?? '')}" alt=""/>` : ''}
        <div>
          <h3>${esc(p.title)}</h3>
          <div class="grid">
            <span>Price</span><b>${usd(p.price)}</b>
            <span>Views</span><b>${p.views}</b>
            <span>Favorites</span><b>${p.favorites}</b>
            <span>Sales</span><b>${p.sales}</b>
            <span>Profit</span><b class="goldtxt">${usd(p.profit)}</b>
            <span>Conversion</span><b>${p.views ? ((p.sales / p.views) * 100).toFixed(1) : '0'}%</b>
          </div>
        </div>
      </div>
      <canvas class="chart" width="320" height="70" data-chart="product" data-id="${p.id}"></canvas>
      <div class="chips">${p.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="muted">Listed ${when(p.listedAt)}${p.externalId ? ` · listing ${esc(p.externalId)}` : ''}</div>`;
  }

  private drawCharts(): void {
    document.querySelectorAll<HTMLCanvasElement>('canvas.chart').forEach((c) => {
      if (c.dataset.chart === 'net') drawBars(c, this.realm.state.days.slice(-30).map(netOf), 'Net per day');
      else {
        const p = this.realm.state.products.find((x) => x.id === c.dataset.id);
        drawBars(c, p?.dailySales ?? [], 'Sales per day');
      }
    });
  }

  // ───────────────────────────── ledger ─────────────────────────────

  private renderLedger(): void {
    const s = this.realm.state;
    const key = this.ledgerSort;
    const products = [...s.products].sort((a, b) => (b[key] as number) - (a[key] as number));
    const rows = products
      .map((p) => {
        const d = s.designs.find((x) => x.id === p.designId);
        const q = s.quests.find((x) => x.id === p.questId);
        return `
        <tr class="${p.status}" data-action="select-product" data-id="${p.id}">
          <td>${d ? `<img src="${designDataUrl(d.art, q?.emoji ?? q?.theme ?? '', 256)}" alt=""/>` : ''}</td>
          <td><b>${esc(p.title)}</b><br/><small>${p.productType} · ${esc(q?.name ?? '')}${p.status === 'retired' ? ' · closed' : ''}</small></td>
          <td>${usd(p.price)}</td><td>${p.views}</td><td>${p.favorites}</td><td>${p.sales}</td>
          <td class="goldtxt">${usd(p.profit)}</td>
          <td>${sparkline(p.dailySales.slice(-14))}</td>
        </tr>`;
      })
      .join('');
    const th = (label: string, k?: keyof Product) => `<th ${k ? `data-action="sort" data-key="${k}" class="${k === key ? 'on' : ''}"` : ''}>${label}</th>`;
    const m = s.money;
    setHtml(this.el.ledger, `
      <div class="ledger-inner">
        <button class="close" data-action="ledger">×</button>
        <h2>The Ledger of the Realm</h2>
        <div class="kpis">
          <div><small>Net</small><b class="${this.realm.net < 0 ? 'warn' : 'goldtxt'}">${usd(this.realm.net)}</b></div>
          <div><small>Revenue</small><b>${usd(m.revenue)}</b></div>
          <div><small>Production</small><b>${usd(m.production)}</b></div>
          <div><small>Etsy + listing fees</small><b>${usd(m.etsyFees + m.listingFees)}</b></div>
          <div><small>AI spend</small><b>${usd(m.aiSpend)}</b></div>
          <div><small>Sales</small><b>${m.sales}</b></div>
          <div><small>AI cost per sale</small><b>${m.sales ? usd(m.aiSpend / m.sales) : '–'}</b></div>
        </div>
        <canvas class="chart wide" width="900" height="110" data-chart="net"></canvas>
        <table>
          <thead><tr>${th('')}${th('Ware')}${th('Price', 'price')}${th('Views', 'views')}${th('Favs', 'favorites')}${th('Sales', 'sales')}${th('Profit', 'profit')}${th('14 days')}</tr></thead>
          <tbody>${rows || '<tr><td colspan="8" class="empty">No wares yet.</td></tr>'}</tbody>
        </table>
        <div class="danger"><button class="btn no" data-action="reset">Start a new realm</button></div>
      </div>`);
    this.drawCharts();
  }

  // ───────────────────────────── chronicle & toasts ─────────────────────────────

  private appendChronicle(e: ChronicleEntry): void {
    const li = document.createElement('li');
    li.className = e.tone;
    li.innerHTML = `<time>${when(e.at)}</time> ${esc(e.text)}`;
    this.el.chronicle.prepend(li);
    while (this.el.chronicle.children.length > 80) this.el.chronicle.lastElementChild!.remove();
  }

  toast(text: string, tone: string): void {
    const t = document.createElement('div');
    t.className = `toast ${tone}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3500);
    setTimeout(() => t.remove(), 4200);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstElementChild!.remove();
  }

  // ───────────────────────────── input ─────────────────────────────

  private bind(): void {
    document.body.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!t || t.matches('input, select')) return;
      const { action, id, value, key } = t.dataset;
      switch (action) {
        case 'send-scouts':
          this.realm.dispatchScouts(Number(t.dataset.count) || 1);
          break;
        case 'send-count':
          this.sendCount = Math.max(1, Math.min(12, this.sendCount + Number(t.dataset.delta)));
          break;
        case 'cancel-scouts':
          this.realm.cancelPendingScouts();
          break;
        case 'consult-seer':
          this.realm.requestSeer();
          break;
        case 'poll-market':
          void this.realm.pollMarket();
          this.toast('🔄 Checking the market…', 'good');
          break;
        case 'decide':
          this.decide(id!, value === '1');
          break;
        case 'approve-all':
          for (const a of [...this.realm.state.approvals]) this.decide(a.id, true);
          break;
        case 'select-agent':
          this.world.select({ type: 'agent', id: id! });
          break;
        case 'select-building':
          this.world.select({ type: 'building', id: id as BuildingId });
          break;
        case 'select-product':
          this.ledgerOpen = false;
          this.el.ledger.classList.remove('open');
          this.world.select({ type: 'product', id: id! });
          break;
        case 'deselect':
          this.world.select(null);
          break;
        case 'ledger':
          this.toggleLedger();
          break;
        case 'sort':
          this.ledgerSort = key as keyof Product;
          this.renderLedger();
          break;
        case 'zoom': {
          const d = this.realm.state.designs.find((x) => x.id === id);
          if (d) this.zoom(d);
          break;
        }
        case 'help':
          showIntro(true);
          break;
        case 'reset':
          if (t.dataset.armed) this.realm.reset();
          else {
            t.dataset.armed = '1';
            t.textContent = 'Click again to abandon this realm';
          }
          return;
      }
      this.renderAll();
      this.renderInspector(true);
    });

    document.body.addEventListener('change', (ev) => {
      const t = ev.target as HTMLInputElement;
      const pool = t.dataset.pool as ManaPool;
      const patrol = this.realm.state.scout.patrol;
      switch (t.dataset.action) {
        case 'trust':
          this.realm.setTrust(t.dataset.kind as ApprovalKind, t.checked);
          break;
        case 'mana-limit':
          if (t.value !== '') this.realm.setManaLimit(pool, Number(t.value));
          break;
        case 'mana-unlimited':
          this.realm.setManaLimit(pool, t.checked ? null : (POOLS[pool].defaultLimit ?? 100));
          break;
        case 'send-count-input':
          this.sendCount = Math.max(1, Math.min(12, Math.round(Number(t.value)) || 1));
          break;
        case 'scout-source':
          this.realm.setScoutOptions({ source: t.value as 'real' | 'simulated' });
          void this.refreshStatus();
          break;
        case 'scout-focus':
          this.realm.setScoutOptions({ focus: t.value });
          break;
        case 'patrol-enabled':
          this.realm.setPatrol({ enabled: t.checked });
          break;
        case 'patrol-every': {
          const unit = (this.el.inspector.querySelector<HTMLSelectElement>('[data-action="patrol-unit"]')?.value ?? 'hours') as Unit;
          this.realm.setPatrol({ everyMinutes: Math.max(1, Number(t.value) || 1) * UNITS[unit] });
          break;
        }
        case 'patrol-unit': {
          const every = Number(this.el.inspector.querySelector<HTMLInputElement>('[data-action="patrol-every"]')?.value) || splitInterval(patrol.everyMinutes).value;
          this.realm.setPatrol({ everyMinutes: every * UNITS[t.value as Unit] });
          break;
        }
        case 'patrol-count':
          this.realm.setPatrol({ count: Number(t.value) || 1 });
          break;
        default:
          return;
      }
      t.blur();
      this.renderInspector(true);
    });

    addEventListener('keydown', (ev) => {
      if ((ev.target as HTMLElement).closest('textarea, input, select')) return;
      if (ev.code === 'Escape') {
        this.world.select(null);
        this.ledgerOpen = false;
        this.el.ledger.classList.remove('open');
      } else if (ev.code === 'KeyL') this.toggleLedger();
      this.renderAll();
    });
  }

  private toggleLedger(): void {
    this.ledgerOpen = !this.ledgerOpen;
    this.el.ledger.classList.toggle('open', this.ledgerOpen);
    if (this.ledgerOpen) this.renderLedger();
  }

  private decide(approvalId: string, approve: boolean): void {
    const a = this.realm.state.approvals.find((x) => x.id === approvalId);
    if (a?.kind === 'reply') {
      const ta = document.querySelector<HTMLTextAreaElement>(`textarea[data-raven="${a.refId}"]`);
      const raven = this.realm.state.ravens.find((r) => r.id === a.refId);
      if (ta && raven) raven.draftReply = ta.value;
    }
    const card = document.querySelector(`[data-action="decide"][data-id="${approvalId}"]`)?.closest('.card');
    card?.classList.add(approve ? 'sealed' : 'burned');
    setTimeout(() => this.realm.decide(approvalId, approve), card ? 350 : 0);
  }

  private zoom(d: Design): void {
    const q = this.realm.state.quests.find((x) => x.id === d.questId);
    const overlay = document.createElement('div');
    overlay.className = 'zoom';
    overlay.innerHTML = `<img src="${designDataUrl(d.art, q?.emoji ?? q?.theme ?? '', 512)}" alt=""/><p>${esc(d.title)}</p>`;
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function byId(id: string): HTMLElement {
  return document.getElementById(id)!;
}

/** Only touch the DOM when content changed, so hover states and clicks survive re-renders. */
function setHtml(el: HTMLElement, html: string): void {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

function meter(label: string, v: number, tone: string): string {
  return `<div class="meter ${tone}"><span>${label}</span><div class="bar"><i style="width:${pct(Math.max(0, Math.min(1, v)))}"></i></div></div>`;
}

function evidenceBlock(e: QuestEvidence, costUsd?: number): string {
  const n = (v: number) => v.toLocaleString('en-US');
  return `
    <div class="evidence">
      <div class="grid">
        <span>Etsy search</span><b>"${esc(e.searchPhrase)}"</b>
        <span>Active listings</span><b>${n(e.listingCount)}</b>
        <span>Median price</span><b>${usd(e.medianPrice)}</b>
        <span>Median favorites (top 100)</span><b>${n(e.medianFavorites)}</b>
        <span>Favorites / month</span><b>${e.medianFavoritesPerMonth}</b>
        <span>Top shops' median sales</span><b>${e.medianShopSales === null ? '–' : n(e.medianShopSales)} <small>(${e.shopsSampled} shops)</small></b>
      </div>
      ${e.risks.length ? `<div class="risks">⚠ ${e.risks.map(esc).join(' · ')}</div>` : ''}
      <details>
        <summary>Top listings & shops</summary>
        ${e.topListings.map((l) => `<div class="mini"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title.slice(0, 70))}</a> <small>${usd(l.price)} · ♥ ${n(l.favorites)} · ${l.ageDays}d old</small></div>`).join('')}
        ${e.topShops.map((sh) => `<div class="mini">🏪 <a href="${esc(sh.url)}" target="_blank" rel="noopener noreferrer">${esc(sh.name)}</a> <small>${n(sh.sales)} sales · ${n(sh.reviews)} reviews/yr</small></div>`).join('')}
        ${e.topTags.length ? `<div class="chips">${e.topTags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      </details>
      ${e.runnersUp.length ? `<details><summary>Also considered (${e.runnersUp.length})</summary>${e.runnersUp.map((r) => `<div class="mini">${esc(r.name)} <small>"${esc(r.searchPhrase)}" · ${n(r.listingCount)} listings · ${r.medianFavoritesPerMonth} fav/mo</small></div>`).join('')}</details>` : ''}
      <div class="muted">Fetched ${when(e.fetchedAt)} · ${e.claudeCalls} Claude + ${e.etsyCalls} Etsy calls${costUsd !== undefined ? ` · cost ${usd(costUsd)}` : ''}</div>
    </div>`;
}

function riskLabel(r: Design['risk']): string {
  return r === 'high' ? '⚠ High risk' : r === 'low' ? '◐ Minor flaw' : '✔ Clean';
}

function questStats(q: Quest, products: Product[]): string {
  const ps = products.filter((p) => p.questId === q.id);
  if (!ps.length) return '';
  const sales = ps.reduce((a, p) => a + p.sales, 0);
  return `<small>· ${ps.length} wares · ${sales} sales</small>`;
}

function sparkline(data: number[]): string {
  if (!data.length) return '';
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * 80},${22 - (v / max) * 20}`).join(' ');
  return `<svg width="80" height="24" class="spark"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}

/** Bar chart that handles negative values (losses hang below the baseline). */
function drawBars(c: HTMLCanvasElement, data: number[], title: string): void {
  const ctx = c.getContext('2d')!;
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(60,40,20,0.7)';
  ctx.font = '11px Cinzel, serif';
  ctx.fillText(title, 4, 12);
  if (!data.length) return;
  const max = Math.max(0, ...data);
  const min = Math.min(0, ...data);
  const span = Math.max(1e-6, max - min);
  const top = 18;
  const plot = h - top - 4;
  const zero = top + (max / span) * plot;
  const bw = (w - 8) / Math.max(10, data.length);
  ctx.strokeStyle = 'rgba(60,40,20,0.3)';
  ctx.beginPath();
  ctx.moveTo(4, zero);
  ctx.lineTo(w - 4, zero);
  ctx.stroke();
  data.forEach((v, i) => {
    const bh = (Math.abs(v) / span) * plot;
    ctx.fillStyle = v < 0 ? '#9b2c22' : i === data.length - 1 ? '#c98e1a' : '#8a6a2a';
    ctx.fillRect(4 + i * bw, v < 0 ? zero : zero - bh, Math.max(1, bw - 2), Math.max(v ? 1 : 0, bh));
  });
}

export function showIntro(force = false): void {
  let seen = false;
  try {
    seen = !!localStorage.getItem('etsy-realm-intro-v3');
  } catch {
    /* ignore */
  }
  if (seen && !force) return;
  const el = document.createElement('div');
  el.className = 'intro';
  el.innerHTML = `
    <div class="scroll">
      <h1>⚜ The Steward's Realm ⚜</h1>
      <p class="lore">A live view of your print-on-demand shop. Every agent you see is a real job in progress. The treasury shows only real money: what you spent and what you earned.</p>
      <ol>
        <li><b>🏹 Scouts</b> go out only when you send them. Click the Watchtower to send some now (several at once if you like) or to set a patrol schedule.</li>
        <li><b>🪶 Scribes</b> turn approved quests into briefs. <b>✨ Mages</b> forge the artwork. <b>🛡️ Wardens</b> check it.</li>
        <li>You approve designs, and <b>⚖️ Merchants</b> list them in the Grand Market.</li>
        <li>Sales send coins to the Treasury and caravans to the print partner. <b>🔮 The Seer</b> reviews the stalls daily. <b>🐦‍⬛ Heralds</b> answer customers.</li>
      </ol>
      <p class="muted"><b>🖋 Ink</b> (LLM calls) and <b>✦ Arcana</b> (images) are your own daily AI budget limits. They reset at midnight, and you can set them on the Scriptorium and the Tower.</p>
      <p class="muted">Move the camera with <b>WASD</b>, rotate with <b>Q/E</b>, zoom with <b>R/F</b> or the mouse wheel, and hold <b>Shift</b> to go faster. Click anything to inspect it. Press <b>L</b> for the ledger.</p>
      <p class="muted"><b>Simulation mode:</b> the agents use mock providers and no real APIs are called yet.</p>
      <button class="btn yes">Take the seat of the Steward</button>
    </div>`;
  el.querySelector('button')!.addEventListener('click', () => {
    el.remove();
    try {
      localStorage.setItem('etsy-realm-intro-v3', '1');
    } catch {
      /* ignore */
    }
  });
  document.body.appendChild(el);
}
