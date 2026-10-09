/**
 * Minimal client for the public Etsy Open API v3 endpoints the scout uses.
 * Field names follow Etsy's published OpenAPI spec (https://www.etsy.com/openapi/generated/oas/3.0.0.json).
 * Public endpoints only need the app's `x-api-key: keystring:shared_secret` header — no OAuth.
 */

const BASE = 'https://openapi.etsy.com/v3/application';

export interface EtsyMoney {
  amount: number;
  divisor: number;
  currency_code: string;
}

export interface EtsyListing {
  listing_id: number;
  title: string;
  url: string;
  num_favorers: number;
  price: EtsyMoney;
  original_creation_timestamp: number;
  creation_timestamp: number;
  tags: string[];
  shop_id: number;
}

export interface EtsyShop {
  shop_id: number;
  shop_name: string;
  url: string;
  transaction_sold_count: number;
  review_count: number;
  review_average: number | null;
  create_date: number;
  listing_active_count: number;
}

export class EtsyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class EtsyClient {
  /** remaining calls in Etsy's 24h sliding window, from the last response's headers */
  remainingToday: number | null = null;
  limitPerDay: number | null = null;
  calls = 0;

  constructor(private apiKey: string) {}

  private async get<T>(path: string, params: Record<string, string | number> = {}, retried = false): Promise<T> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url, { headers: { 'x-api-key': this.apiKey } });
    this.calls++;
    const remaining = res.headers.get('x-remaining-today');
    const limit = res.headers.get('x-limit-per-day');
    if (remaining !== null) this.remainingToday = Number(remaining);
    if (limit !== null) this.limitPerDay = Number(limit);

    if (res.status === 429 && !retried) {
      const wait = Math.min(10, Number(res.headers.get('retry-after') ?? '1'));
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.get<T>(path, params, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new EtsyError(`Etsy ${res.status} on ${path}: ${body.slice(0, 200)}`, res.status);
    }
    return (await res.json()) as T;
  }

  /** findAllListingsActive — the top `limit` active listings for a search phrase, prices in USD. */
  searchListings(keywords: string, limit = 100): Promise<{ count: number; results: EtsyListing[] }> {
    return this.get('/listings/active', { keywords, limit, sort_on: 'score', currency: 'USD' });
  }

  /** getShop */
  getShop(shopId: number): Promise<EtsyShop> {
    return this.get(`/shops/${shopId}`);
  }
}

/** Runs `fn` over `items` with at most `n` in flight (keeps us well inside Etsy's per-second limit). */
export async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
