import type { BuildingId, Role } from './types';

/**
 * AI budget ("mana"). Every AI call an agent makes spends mana from a daily pool and money
 * (the real cost). Each pool is the Steward's own daily limit and resets at local midnight.
 *
 * NOTE: the usd values are placeholder estimates for the simulation. When real providers are
 * connected, set them from the providers' current pricing.
 */
export type ManaPool = 'ink' | 'arcana';

export interface PoolInfo {
  name: string;
  icon: string;
  /** what this pool represents in the real world */
  meaning: string;
  building: BuildingId;
  color: number;
  /** default daily limit for a new realm (null = unlimited) */
  defaultLimit: number | null;
}

export const POOLS: Record<ManaPool, PoolInfo> = {
  ink: {
    name: 'Ink',
    icon: '🖋',
    meaning: 'LLM calls (research analysis, briefs, inspections, listings, replies)',
    building: 'scriptorium',
    color: 0x3fb6c9,
    defaultLimit: 100,
  },
  arcana: {
    name: 'Arcana',
    icon: '✦',
    meaning: 'Image generations (design artwork)',
    building: 'magetower',
    color: 0xa58bff,
    defaultLimit: 20,
  },
};

export interface ActionCost {
  label: string;
  pool: ManaPool;
  mana: number;
  /** estimated real-money cost per call (USD), charged to the treasury */
  usd: number;
}

/** What each role's task costs. Roles not listed (the seer) only read Etsy stats, which cost no AI. */
export const ROLE_COSTS: Partial<Record<Role, ActionCost>> = {
  // estimate only — real trips report their actual token cost and the ledger is corrected
  scout: { label: 'Trend research (2 Claude calls)', pool: 'ink', mana: 2, usd: 0.08 },
  scribe: { label: 'Design brief', pool: 'ink', mana: 1, usd: 0.02 },
  mage: { label: 'Artwork generation', pool: 'arcana', mana: 1, usd: 0.08 },
  warden: { label: 'Vision inspection', pool: 'ink', mana: 1, usd: 0.03 },
  merchant: { label: 'Listing copy', pool: 'ink', mana: 1, usd: 0.02 },
  herald: { label: 'Reply draft', pool: 'ink', mana: 1, usd: 0.01 },
};
