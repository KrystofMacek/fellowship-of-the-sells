import Anthropic from '@anthropic-ai/sdk';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { EtsyClient, EtsyError } from './etsy';
import { runScout } from './scout';

/**
 * Local API for the realm, served by the Vite dev server. API keys are read from
 * .env.local on this machine and never sent to the browser.
 *
 *   GET  /api/status  → which real providers are configured
 *   POST /api/scout   → one real scouting trip { exclude: string[], focus?: string }
 */
export function realmApi(env: Record<string, string>): Plugin {
  const etsyKey = env.ETSY_API_KEY && env.ETSY_SHARED_SECRET ? `${env.ETSY_API_KEY}:${env.ETSY_SHARED_SECRET}` : null;
  const etsy = etsyKey ? new EtsyClient(etsyKey) : null;
  let claude: Anthropic | null = null;
  let claudeError: string | null = null;
  // The SDK resolves credentials from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
  const hasCredentials =
    !!(env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) ||
    existsSync(join(homedir(), '.config', 'anthropic'));
  if (!hasCredentials) claudeError = 'missing ANTHROPIC_API_KEY (or `ant auth login`)';
  else try {
    // With no ANTHROPIC_API_KEY in .env.local, the SDK falls back to the environment / `ant auth login` profile.
    claude = new Anthropic(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {});
  } catch (err) {
    claudeError = err instanceof Error ? err.message : String(err);
  }

  const status = () => ({
    scout: {
      real: !!(etsy && claude),
      etsy: etsy ? 'configured' : 'missing ETSY_API_KEY / ETSY_SHARED_SECRET',
      claude: claude ? (env.ANTHROPIC_API_KEY ? 'configured' : 'default credentials') : `unavailable: ${claudeError}`,
      etsyRemainingToday: etsy?.remainingToday ?? null,
      etsyLimitPerDay: etsy?.limitPerDay ?? null,
    },
  });

  return {
    name: 'realm-api',
    configureServer(server) {
      server.middlewares.use('/api/status', (_req, res) => json(res, 200, status()));
      server.middlewares.use('/api/scout', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        if (!etsy || !claude) return json(res, 503, { error: 'Real scouting is not configured', status: status() });
        try {
          const body = JSON.parse((await readBody(req)) || '{}') as { exclude?: string[]; focus?: string };
          const result = await runScout({ claude, etsy }, { exclude: body.exclude ?? [], focus: body.focus?.trim() || undefined });
          json(res, 200, result);
        } catch (err) {
          server.config.logger.error(`[scout] ${err instanceof Error ? err.stack : String(err)}`);
          json(res, 502, { error: describe(err) });
        }
      });
    },
  };
}

function describe(err: unknown): string {
  if (err instanceof EtsyError) return err.status === 403 || err.status === 401 ? 'Etsy rejected the API key (check ETSY_API_KEY / ETSY_SHARED_SECRET)' : err.message;
  if (err instanceof Anthropic.AuthenticationError) return 'Claude rejected the credentials (check ANTHROPIC_API_KEY)';
  if (err instanceof Anthropic.RateLimitError) return 'Claude rate limit reached, try again shortly';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
