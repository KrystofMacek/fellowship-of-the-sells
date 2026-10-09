import type { Brief, Design, DesignArt, DesignStyle, Product, ProductType, Quest, QuestEvidence, Raven } from './types';
import { CUSTOMERS, NICHES, PALETTES, PRODUCT_TYPES, RAVEN_MESSAGES } from './lore';

/**
 * Everything the realm needs from the outside world.
 *
 * The game only talks to these functions. `MockProviders` simulates them so the
 * realm runs offline; a real implementation would call a small backend that holds
 * the Etsy / Printify / image-model / Claude API keys.
 */
export interface RealmProviders {
  /** Research: find a promising niche. `source` picks real (Claude + Etsy API) or simulated data. */
  scoutNiche(existing: Quest[], opts: { focus: string; source: 'real' | 'simulated' }): Promise<NicheProposal>;
  /** LLM: write an original design brief inspired by (not copied from) the niche. */
  writeBrief(quest: Quest, parent?: Product): Promise<BriefDraft>;
  /** Image model: generate artwork for the brief. */
  forgeDesign(brief: Brief, quest: Quest): Promise<ForgedDesign>;
  /** Vision LLM + trademark lookup: flag anything risky. */
  inspectDesign(design: Design, quest: Quest): Promise<Inspection>;
  /** Printify: create product + mockups, publish to Etsy. LLM writes title/tags. */
  publishListing(design: Design, quest: Quest): Promise<ListingDraft>;
  /** Etsy: deactivate a listing. */
  retireListing(product: Product): Promise<void>;
  /** Etsy stats: per-listing views/favorites/sales in the window [fromMs, toMs). */
  marketReport(products: Product[], ctx: MarketContext): Promise<DailyStat[]>;
  /** Etsy conversations: customer messages received in the window. */
  pollRavens(products: Product[], ctx: { sales: number; windowMs: number }): Promise<RavenDraft[]>;
  /** LLM: draft a reply to a customer. */
  draftReply(raven: Raven): Promise<string>;
  /** Etsy conversations: send the approved reply. */
  sendReply(raven: Raven): Promise<void>;
}

export type NicheProposal = Pick<Quest, 'name' | 'theme' | 'keywords' | 'demand' | 'competition' | 'avgPrice' | 'rationale'> & {
  emoji?: string;
  evidence?: QuestEvidence;
  /** actual cost of the trip in USD, when the provider knows it */
  costUsd?: number;
  source: Quest['source'];
};
export type BriefDraft = Pick<Brief, 'concept' | 'style' | 'text' | 'palette'>;
export interface ForgedDesign { title: string; art: DesignArt; quality: number }
export interface Inspection { risk: Design['risk']; notes: string }
export interface ListingDraft { title: string; productType: ProductType; price: number; cost: number; tags: string[]; externalId?: string }
export interface DailyStat { productId: string; views: number; favorites: number; sales: number }
export interface RavenDraft { customer: string; message: string; productId?: string }
export interface MarketContext {
  questById: Map<string, Quest>;
  designById: Map<string, Design>;
  fromMs: number;
  toMs: number;
}

const DAY_MS = 86_400_000;

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const jitter = (v: number, amount: number) => clamp01(v + (Math.random() * 2 - 1) * amount);

function poisson(lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gaussian()));
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > l);
  return k - 1;
}

function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Simulated network latency so the async flow behaves like real API calls. */
const latency = <T>(value: T, min = 150, max = 700): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), min + Math.random() * (max - min)));

const CONCEPT_TEMPLATES: Record<DesignStyle, string[]> = {
  badge: ['Vintage circular badge with {theme} emblem and arched lettering', 'Distressed patch-style crest featuring a {theme}'],
  lineart: ['Single continuous line drawing of a {theme}, minimal and elegant', 'Fine-line {theme} illustration with delicate details'],
  retro: ['70s sunset stripes behind a {theme} silhouette', 'Groovy retro wave lettering with a playful {theme}'],
  typography: ['Bold hand-lettered phrase with a small {theme} accent', 'Stacked serif typography framed by {theme} doodles'],
  celestial: ['Moon phases and stars orbiting a mystical {theme}', 'Tarot-card frame around a celestial {theme}'],
  botanical: ['Pressed-flower arrangement around a {theme}', 'Vintage botanical plate study of a {theme}'],
};

export class MockProviders implements RealmProviders {
  /** niches handed out recently, so parallel scouts don't all return the same one */
  private recent: string[] = [];

  async scoutNiche(existing: Quest[], opts: { focus: string; source: 'real' | 'simulated' }): Promise<NicheProposal> {
    if (opts.source === 'real') return scoutViaServer(existing, opts.focus);
    const taken = new Set([...existing.filter((q) => q.status !== 'rejected').map((q) => q.name), ...this.recent]);
    const pool = NICHES.filter((n) => !taken.has(n.name));
    const seed = pick(pool.length ? pool : NICHES);
    this.recent.push(seed.name);
    if (this.recent.length > 8) this.recent.shift();
    const demand = jitter(seed.demand, 0.08);
    const competition = jitter(seed.competition, 0.08);
    const opportunity = demand * (1 - competition);
    const verdict = opportunity > 0.3 ? 'a rare opening' : opportunity > 0.2 ? 'a fair hunting ground' : 'a crowded field';
    return latency({
      name: seed.name,
      theme: seed.theme,
      keywords: seed.keywords,
      demand,
      competition,
      avgPrice: 18 + Math.random() * 14,
      rationale: `(Simulated) Searches for "${seed.keywords[0]}" are ${demand > 0.7 ? 'rising fast' : 'steady'}. About ${Math.round(competition * 40 + 5)}k listings compete. It looks like ${verdict}.`,
      source: 'simulated' as const,
    }, 400, 1200);
  }

  async writeBrief(quest: Quest, parent?: Product): Promise<BriefDraft> {
    const seed = NICHES.find((n) => n.name === quest.name);
    const style = pick(seed?.styles ?? (['badge', 'retro', 'typography'] as DesignStyle[]));
    const concept = pick(CONCEPT_TEMPLATES[style]).replace('{theme}', quest.theme);
    return latency({
      concept: parent ? `Variant of "${parent.title}": ${concept.toLowerCase()}` : concept,
      style,
      text: pick(seed?.phrases ?? [quest.name]),
      palette: pick(PALETTES),
    });
  }

  async forgeDesign(brief: Brief, quest: Quest): Promise<ForgedDesign> {
    const quality = clamp01(0.35 + Math.random() * 0.5 + (brief.parentProductId ? 0.08 : 0));
    return latency({
      title: `${brief.text} ${quest.theme.charAt(0).toUpperCase() + quest.theme.slice(1)}`,
      art: { seed: Math.floor(Math.random() * 1e9), style: brief.style, text: brief.text, palette: brief.palette },
      quality,
    }, 600, 1800);
  }

  async inspectDesign(design: Design): Promise<Inspection> {
    const roll = Math.random();
    if (roll < 0.08) return latency({ risk: 'high', notes: 'The phrase looks like a registered trademark. I advise rejecting it.' });
    if (roll < 0.22) return latency({ risk: 'low', notes: 'The lettering is a bit soft at small sizes. It is acceptable for posters.' });
    return latency({ risk: 'none', notes: design.quality > 0.75 ? 'Clean, original work. A fine piece.' : 'Original work. Nothing infringes.' });
  }

  async publishListing(design: Design, quest: Quest): Promise<ListingDraft> {
    const styleFit: Record<DesignStyle, ProductType[]> = {
      badge: ['T-Shirt', 'Hoodie', 'Sticker'],
      lineart: ['Poster', 'Tote Bag', 'Mug'],
      retro: ['T-Shirt', 'Hoodie', 'Mug'],
      typography: ['Mug', 'T-Shirt', 'Tote Bag'],
      celestial: ['Poster', 'Tote Bag', 'T-Shirt'],
      botanical: ['Poster', 'Mug', 'Tote Bag'],
    };
    const productType = pick(styleFit[design.art.style]);
    const info = PRODUCT_TYPES[productType];
    const price = Math.round((info.price * (0.9 + Math.random() * 0.25)) * 100) / 100;
    return latency({
      title: `${design.title} ${productType} | ${quest.keywords.slice(0, 2).map(cap).join(' ')} Gift`,
      productType,
      price,
      cost: info.cost,
      tags: [...quest.keywords, productType.toLowerCase(), 'gift idea', `${quest.theme} lover`].slice(0, 13),
      externalId: `mock-${Math.floor(Math.random() * 1e8)}`,
    });
  }

  async retireListing(): Promise<void> {
    return latency(undefined);
  }

  async marketReport(products: Product[], ctx: MarketContext): Promise<DailyStat[]> {
    const window = Math.max(0, ctx.toMs - ctx.fromMs) / DAY_MS;
    const stats = products.map((p) => {
      const quest = ctx.questById.get(p.questId);
      const design = ctx.designById.get(p.designId);
      const demand = quest?.demand ?? 0.5;
      const competition = quest?.competition ?? 0.5;
      const quality = design?.quality ?? 0.5;
      const ageDays = (ctx.toMs - p.listedAt) / DAY_MS;
      const ramp = Math.min(1, (ageDays + 1) / 8);
      const seasonal = 0.85 + 0.3 * Math.sin((ctx.toMs / DAY_MS + p.questId.length * 7) / 9);
      const lambdaViews = (4 + demand * 70 * (1 - competition * 0.75) * (0.4 + quality)) * ramp * seasonal * window;
      const views = poisson(lambdaViews);
      const info = PRODUCT_TYPES[p.productType];
      const priceFactor = Math.pow(info.price / p.price, 1.5);
      const conversion = info.conversion * (0.4 + quality * 1.2) * priceFactor;
      const sales = Math.min(views, poisson(views * conversion));
      const favorites = poisson(views * 0.06);
      return { productId: p.id, views, favorites, sales };
    });
    return latency(stats, 100, 300);
  }

  async pollRavens(products: Product[], ctx: { sales: number; windowMs: number }): Promise<RavenDraft[]> {
    const chance = Math.min(0.85, 0.05 * (ctx.windowMs / DAY_MS) + ctx.sales * 0.12);
    if (!products.length || Math.random() > chance) return [];
    const product = pick(products);
    return [{ customer: pick(CUSTOMERS), message: pick(RAVEN_MESSAGES).message, productId: product.id }];
  }

  async draftReply(raven: Raven): Promise<string> {
    const known = RAVEN_MESSAGES.find((m) => m.message === raven.message);
    return latency(known?.reply ?? 'Thank you so much for reaching out! I\'ll look into this right away.');
  }

  async sendReply(): Promise<void> {
    return latency(undefined);
  }
}

/** Real scouting runs on the local server (server/scout.ts), which holds the Claude and Etsy keys. */
async function scoutViaServer(existing: Quest[], focus: string): Promise<NicheProposal> {
  const exclude = existing.filter((q) => q.status !== 'rejected').map((q) => q.name);
  const res = await fetch('/api/scout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ exclude, focus }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<NicheProposal> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `scout server returned ${res.status}`);
  return { ...(body as NicheProposal), source: 'etsy' };
}

function cap(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
