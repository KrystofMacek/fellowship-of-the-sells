import type Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic first-party API prices in USD per million tokens (as of 2026-10).
 * The scout uses Claude Opus 5.5; the others are listed because a server-side
 * refusal fallback may serve part of a request on a different model.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
};

interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function priced(model: string, u: TokenCounts): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5'];
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  return (u.input_tokens * p.input + cacheWrite * p.input * 1.25 + cacheRead * p.cacheRead + u.output_tokens * p.output) / 1_000_000;
}

/** Real cost of one response. When a fallback ran, each iteration is priced at the model that served it. */
export function costOf(message: Anthropic.Beta.BetaMessage): number {
  const iterations = message.usage.iterations;
  if (iterations?.length) {
    return iterations.reduce((sum, it) => sum + priced(('model' in it && it.model) || message.model, it), 0);
  }
  return priced(message.model, message.usage);
}
