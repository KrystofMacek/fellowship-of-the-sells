import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { EtsyClient, mapLimit, type EtsyListing } from './etsy';
import { costOf } from './pricing';

const MODEL = 'claude-opus-5-5';
const CANDIDATES = 5;
const FINALISTS = 2;
const SHOPS_PER_FINALIST = 8;

/** What the realm receives — the same shape as the mock scout, plus real evidence and cost. */
export interface ScoutResult {
  name: string;
  theme: string;
  emoji: string;
  keywords: string[];
  demand: number;
  competition: number;
  avgPrice: number;
  rationale: string;
  evidence: ScoutEvidence;
  costUsd: number;
}

export interface ScoutEvidence {
  source: 'etsy';
  fetchedAt: number;
  searchPhrase: string;
  listingCount: number;
  medianPrice: number;
  medianFavorites: number;
  medianFavoritesPerMonth: number;
  medianShopSales: number | null;
  shopsSampled: number;
  topTags: string[];
  topListings: { title: string; url: string; price: number; favorites: number; ageDays: number }[];
  topShops: { name: string; url: string; sales: number; reviews: number }[];
  risks: string[];
  runnersUp: { name: string; searchPhrase: string; listingCount: number; medianFavoritesPerMonth: number }[];
  etsyCalls: number;
  etsyRemainingToday: number | null;
  claudeCalls: number;
}

const CandidateSchema = z.object({
  candidates: z.array(
    z.object({
      name: z.string().describe('Short human name for the niche, e.g. "Retro Camping"'),
      searchPhrase: z.string().describe('The exact 2-4 word phrase a buyer would type into Etsy search'),
      keywords: z.array(z.string()).describe('4 related search keywords / tags'),
      theme: z.string().describe('One lowercase noun naming the central motif, e.g. "mushroom"'),
      emoji: z.string().describe('A single emoji for the motif'),
    }),
  ),
});

const VerdictSchema = z.object({
  chosen: z.string().describe('The name of the finalist you recommend'),
  rationale: z.string().describe('2-3 plain sentences for the shop owner, citing the numbers'),
  risks: z.array(z.string()).describe('0-3 short risks: trademarks/IP, seasonality, saturation'),
});

/** Candidates handed out recently, so scouts sent in parallel explore different niches. */
const recent = new Map<string, number>();

export interface ScoutDeps {
  claude: Anthropic;
  etsy: EtsyClient;
}

export async function runScout(deps: ScoutDeps, req: { exclude: string[]; focus?: string }): Promise<ScoutResult> {
  const { claude, etsy } = deps;
  const callsBefore = etsy.calls;
  let costUsd = 0;
  const now = Date.now();
  for (const [name, at] of recent) if (now - at > 15 * 60_000) recent.delete(name);
  const exclude = [...new Set([...req.exclude, ...recent.keys()])];

  // 1. Claude proposes candidate niches.
  const ideas = await claude.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(CandidateSchema) },
    system:
      'You help a small print-on-demand Etsy shop (t-shirts, mugs, posters, tote bags, stickers) find niches to design original artwork for. ' +
      'Propose niches where original designs could sell: specific audiences, hobbies, aesthetics, humor, or upcoming occasions. ' +
      'Never propose niches built on trademarks, brands, franchises, celebrities, sports teams or other protected IP.',
    messages: [
      {
        role: 'user',
        content:
          `Today is ${new Date(now).toDateString()}. Propose exactly ${CANDIDATES} distinct candidate niches.` +
          (req.focus ? ` Focus on: ${req.focus}.` : ' Mix evergreen niches with ones that fit the coming season.') +
          (exclude.length ? ` Do not propose these, or close variants of them: ${exclude.join('; ')}.` : ''),
      },
    ],
  });
  costUsd += costOf(ideas);
  if (ideas.stop_reason === 'refusal') throw new Error('Claude declined to propose niches.');
  const candidates = ideas.parsed_output?.candidates.slice(0, CANDIDATES) ?? [];
  if (!candidates.length) throw new Error('Claude returned no candidate niches.');
  for (const c of candidates) recent.set(c.name, now);

  // 2. Etsy: real listing data for every candidate.
  const measured = await mapLimit(candidates, 3, async (c) => {
    const { count, results } = await etsy.searchListings(c.searchPhrase);
    return { ...c, count, listings: results, stats: listingStats(results, now) };
  });

  // 3. Etsy: real shop sales for the most promising candidates.
  const ranked = [...measured].sort((a, b) => firstPassScore(b.count, b.stats) - firstPassScore(a.count, a.stats));
  const finalists = await mapLimit(ranked.slice(0, FINALISTS), 1, async (m) => {
    const shopIds = [...new Set(m.listings.slice(0, 30).map((l) => l.shop_id))].slice(0, SHOPS_PER_FINALIST);
    const shops = await mapLimit(shopIds, 3, (id) => etsy.getShop(id).catch(() => null));
    const known = shops.filter((s): s is NonNullable<typeof s> => !!s);
    const medianShopSales = known.length ? median(known.map((s) => s.transaction_sold_count)) : null;
    return { ...m, shops: known, medianShopSales };
  });

  // 4. Claude weighs the finalists and explains the pick in plain language.
  const brief = finalists.map((f) => ({
    name: f.name,
    searchPhrase: f.searchPhrase,
    activeListings: f.count,
    medianPriceUsd: round(f.stats.medianPrice),
    medianFavoritesTop100: f.stats.medianFavorites,
    medianFavoritesPerMonth: round(f.stats.medianFavPerMonth),
    medianLifetimeSalesOfTopShops: f.medianShopSales,
    commonTags: topTags(f.listings, 8),
    sampleTitles: f.listings.slice(0, 8).map((l) => l.title.slice(0, 90)),
  }));
  const verdict = await claude.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(VerdictSchema) },
    system:
      'You advise a small print-on-demand Etsy shop that sells original designs. Judge niches only from the data given. ' +
      'Fewer active listings means less competition; favorites per month and top-shop sales indicate buyer demand. ' +
      'Write for a busy shop owner: plain words, concrete numbers, no hype.',
    messages: [{ role: 'user', content: `Pick the better niche to pursue and explain why.\n\n${JSON.stringify(brief, null, 2)}` }],
  });
  costUsd += costOf(verdict);
  const v = verdict.stop_reason === 'refusal' ? null : verdict.parsed_output;
  const chosen = finalists.find((f) => f.name === v?.chosen) ?? finalists[0];
  const runnersUp = measured.filter((m) => m.name !== chosen.name);

  const { demand, competition } = scores(chosen.count, chosen.stats.medianFavPerMonth, chosen.medianShopSales);
  return {
    name: chosen.name,
    theme: chosen.theme,
    emoji: chosen.emoji,
    keywords: [chosen.searchPhrase, ...chosen.keywords].slice(0, 5),
    demand,
    competition,
    avgPrice: chosen.stats.medianPrice,
    rationale: v?.rationale ?? 'Picked on the numbers alone (Claude gave no verdict).',
    costUsd,
    evidence: {
      source: 'etsy',
      fetchedAt: now,
      searchPhrase: chosen.searchPhrase,
      listingCount: chosen.count,
      medianPrice: round(chosen.stats.medianPrice),
      medianFavorites: chosen.stats.medianFavorites,
      medianFavoritesPerMonth: round(chosen.stats.medianFavPerMonth),
      medianShopSales: chosen.medianShopSales,
      shopsSampled: chosen.shops.length,
      topTags: topTags(chosen.listings, 10),
      topListings: [...chosen.listings]
        .sort((a, b) => b.num_favorers - a.num_favorers)
        .slice(0, 5)
        .map((l) => ({ title: l.title, url: l.url, price: round(price(l)), favorites: l.num_favorers, ageDays: Math.round(ageDays(l, now)) })),
      topShops: [...chosen.shops]
        .sort((a, b) => b.transaction_sold_count - a.transaction_sold_count)
        .slice(0, 5)
        .map((s) => ({ name: s.shop_name, url: s.url, sales: s.transaction_sold_count, reviews: s.review_count })),
      risks: v?.risks ?? [],
      runnersUp: runnersUp.map((m) => ({ name: m.name, searchPhrase: m.searchPhrase, listingCount: m.count, medianFavoritesPerMonth: round(m.stats.medianFavPerMonth) })),
      etsyCalls: etsy.calls - callsBefore,
      etsyRemainingToday: etsy.remainingToday,
      claudeCalls: 2,
    },
  };
}

// ───────────────────────────── scoring ─────────────────────────────

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round = (v: number) => Math.round(v * 100) / 100;
const price = (l: EtsyListing) => l.price.amount / l.price.divisor;
const ageDays = (l: EtsyListing, now: number) => Math.max(1, (now / 1000 - (l.original_creation_timestamp || l.creation_timestamp)) / 86400);

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function listingStats(listings: EtsyListing[], now: number) {
  return {
    medianPrice: median(listings.map(price)),
    medianFavorites: median(listings.map((l) => l.num_favorers)),
    medianFavPerMonth: median(listings.map((l) => l.num_favorers / (ageDays(l, now) / 30))),
  };
}

function topTags(listings: EtsyListing[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const l of listings) for (const t of l.tags ?? []) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

/**
 * Transparent 0..1 scores from the raw Etsy numbers:
 * - competition: log scale of active listings (100 → 0, 1,000,000 → 1)
 * - demand: favorites per month of the top listings (50+/month → 1), blended with
 *   the lifetime sales of the shops selling them (20,000+ → 1) when known
 */
function scores(listingCount: number, favPerMonth: number, shopSales: number | null) {
  const competition = clamp01((Math.log10(Math.max(1, listingCount)) - 2) / 4);
  const favDemand = clamp01(Math.log10(1 + favPerMonth) / Math.log10(51));
  const shopDemand = shopSales === null ? null : clamp01(Math.log10(1 + shopSales) / Math.log10(20001));
  const demand = shopDemand === null ? favDemand : 0.6 * favDemand + 0.4 * shopDemand;
  return { demand, competition };
}

function firstPassScore(count: number, stats: ReturnType<typeof listingStats>): number {
  const { demand, competition } = scores(count, stats.medianFavPerMonth, null);
  return demand * (1 - competition);
}
