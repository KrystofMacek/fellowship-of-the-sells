export type BuildingId =
  | 'watchtower'
  | 'scriptorium'
  | 'magetower'
  | 'gatehouse'
  | 'council'
  | 'market'
  | 'treasury'
  | 'oracle'
  | 'rookery';

export type Role = 'scout' | 'scribe' | 'mage' | 'warden' | 'merchant' | 'oracle' | 'herald';

export type ProductType = 'T-Shirt' | 'Hoodie' | 'Mug' | 'Poster' | 'Tote Bag' | 'Sticker';

export type DesignStyle = 'badge' | 'lineart' | 'retro' | 'typography' | 'celestial' | 'botanical';

/** All timestamps are real wall-clock milliseconds (Date.now()). */
type Ms = number;

/** A trending niche the scouts found. Becomes a "quest" once approved. */
export interface Quest {
  id: string;
  name: string;
  theme: string;
  keywords: string[];
  /** 0..1 how much buyers search for this */
  demand: number;
  /** 0..1 how crowded the niche is */
  competition: number;
  avgPrice: number;
  rationale: string;
  /** emoji for the motif (real scout) */
  emoji?: string;
  /** where the numbers came from */
  source: 'etsy' | 'simulated';
  /** real market evidence behind the proposal (real scout only) */
  evidence?: QuestEvidence;
  /** what this scouting trip actually cost, USD */
  costUsd?: number;
  status: 'proposed' | 'active' | 'completed' | 'rejected';
  briefsWritten: number;
  createdAt: Ms;
}

export interface QuestEvidence {
  fetchedAt: Ms;
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

export interface Brief {
  id: string;
  questId: string;
  concept: string;
  style: DesignStyle;
  text: string;
  palette: string[];
  /** set when this brief is a variant of a winning product */
  parentProductId?: string;
  status: 'carried' | 'queued' | 'forging' | 'forged';
}

/** A request for the scribes to write one brief. */
export interface BriefOrder {
  questId: string;
  parentProductId?: string;
}

/** Procedural/AI artwork reference. In mock mode we render `art` with canvas; real mode uses imageUrl. */
export interface DesignArt {
  seed: number;
  style: DesignStyle;
  text: string;
  palette: string[];
  imageUrl?: string;
}

export interface Design {
  id: string;
  questId: string;
  briefId: string;
  title: string;
  concept: string;
  art: DesignArt;
  /** 0..1 — only the mock market uses it */
  quality: number;
  risk: 'none' | 'low' | 'high';
  wardenNotes: string;
  status:
    | 'carried'
    | 'queued-inspection'
    | 'inspecting'
    | 'inspected'
    | 'awaiting'
    | 'approved'
    | 'rejected'
    | 'listing'
    | 'listed';
  createdAt: Ms;
  parentProductId?: string;
}

export interface Product {
  id: string;
  designId: string;
  questId: string;
  title: string;
  productType: ProductType;
  tags: string[];
  price: number;
  /** production + shipping cost charged by the print partner */
  cost: number;
  views: number;
  favorites: number;
  sales: number;
  revenue: number;
  profit: number;
  /** per local calendar day, oldest first, last entry = today */
  dailySales: number[];
  dailyViews: number[];
  status: 'listed' | 'retired';
  listedAt: Ms;
  externalId?: string;
  /** the seer already flagged this product (prevents repeated decrees) */
  oracleFlag?: 'retire' | 'variant' | 'kept';
}

export interface Raven {
  id: string;
  productId?: string;
  customer: string;
  message: string;
  draftReply?: string;
  status: 'arrived' | 'drafting' | 'awaiting' | 'sent' | 'dismissed';
  at: Ms;
}

export type ApprovalKind = 'quest' | 'design' | 'retire' | 'variant' | 'reply';

export interface Approval {
  id: string;
  kind: ApprovalKind;
  refId: string;
  title: string;
  createdAt: Ms;
}

export type AgentPhase = 'idle' | 'working' | 'delivering' | 'returning';

/**
 * A visible worker. Agents appear when there is a job and leave when it is done;
 * one "resident" per role stays at home so every building is inhabited.
 */
export interface Agent {
  id: string;
  name: string;
  role: Role;
  home: BuildingId;
  phase: AgentPhase;
  /** where the agent currently stands / walks from */
  from: BuildingId;
  /** where the agent walks to (same as from when standing) */
  to: BuildingId;
  /** 0..1 walking progress or (estimated) working progress */
  progress: number;
  /** when the current phase started */
  phaseStartedAt: Ms;
  /** label of what the agent is doing, shown in UI */
  activity: string;
  /** opaque reference to the item the agent is handling */
  taskRef?: string;
  /** extra JSON payload for the task (e.g. a brief order, the seer's findings) */
  cargo?: string;
  /** set while the agent waits for its mana pool to reset */
  resting?: 'ink' | 'arcana';
}

export interface ChronicleEntry {
  id: string;
  at: Ms;
  text: string;
  tone: 'info' | 'good' | 'bad' | 'gold' | 'decree';
}

export interface Trust {
  quest: boolean;
  design: boolean;
  retire: boolean;
  variant: boolean;
  reply: boolean;
}

/** Real money, in USD. Net = revenue − production − etsyFees − listingFees − aiSpend. */
export interface Money {
  revenue: number;
  production: number;
  etsyFees: number;
  listingFees: number;
  aiSpend: number;
  sales: number;
}

export interface DayTotals extends Money {
  /** local calendar date, YYYY-MM-DD */
  day: string;
}

export interface ManaState {
  /** mana spent since local midnight */
  spent: number;
  /** the Steward's daily limit; null = unlimited */
  limit: number | null;
  /** last day (YYYY-MM-DD) this pool ran dry, so it is announced once */
  exhaustedDay: string;
}

export interface ScoutPatrol {
  enabled: boolean;
  everyMinutes: number;
  /** scouts sent on each patrol */
  count: number;
  nextAt: Ms | null;
}

export interface RealmState {
  version: number;
  createdAt: Ms;
  /** local calendar date of the current day (for midnight rollover) */
  today: string;
  quests: Quest[];
  briefs: Brief[];
  briefOrders: BriefOrder[];
  designs: Design[];
  products: Product[];
  ravens: Raven[];
  approvals: Approval[];
  agents: Agent[];
  chronicle: ChronicleEntry[];
  trust: Trust;
  nextId: number;
  /** lifetime totals */
  money: Money;
  /** per-day totals, last 60 days, last entry = today */
  days: DayTotals[];
  mana: Record<'ink' | 'arcana', ManaState>;
  scout: {
    /** scouting trips ordered but not yet started */
    pending: number;
    patrol: ScoutPatrol;
    /** optional theme the scouts should look around (applies to sends and patrols) */
    focus: string;
    /** 'real' = Claude + Etsy API via the local server; 'simulated' = mock data */
    source: 'real' | 'simulated';
  };
  oracle: {
    lastAt: Ms;
    /** the Steward asked for a reading */
    requested: boolean;
  };
  lastMarketPollAt: Ms;
}
