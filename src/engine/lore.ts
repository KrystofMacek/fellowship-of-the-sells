import type { BuildingId, DesignStyle, ProductType, Role } from './types';

export interface RoleInfo {
  title: string;
  home: BuildingId;
  description: string;
  color: number;
}

export const ROLES: Record<Role, RoleInfo> = {
  scout: {
    title: 'Ranger Scout',
    home: 'watchtower',
    description: 'Roams the marketplace and spots trending niches worth pursuing.',
    color: 0x3f7d3a,
  },
  scribe: {
    title: 'Scribe',
    home: 'scriptorium',
    description: 'Turns approved quests into original design briefs.',
    color: 0x8a6d3b,
  },
  mage: {
    title: 'Artificer Mage',
    home: 'magetower',
    description: 'Conjures artwork from briefs using the image-spirits.',
    color: 0x4b4fbf,
  },
  warden: {
    title: 'Gate Warden',
    home: 'gatehouse',
    description: 'Inspects every design for trademarks, likenesses and flaws.',
    color: 0x6b6b72,
  },
  merchant: {
    title: 'Merchant',
    home: 'market',
    description: 'Writes listings, sets prices and opens stalls in the market.',
    color: 0xb5562a,
  },
  oracle: {
    title: 'Seer',
    home: 'oracle',
    description: 'Reads the ledgers and foresees which wares to retire or expand.',
    color: 0x7a3fa0,
  },
  herald: {
    title: 'Herald',
    home: 'rookery',
    description: 'Reads ravens from customers and drafts courteous replies.',
    color: 0x2f6f8f,
  },
};

export interface BuildingInfo {
  name: string;
  description: string;
}

export const BUILDINGS: Record<BuildingId, BuildingInfo> = {
  watchtower: {
    name: 'The Watchtower',
    description: 'From here the scouts survey the great bazaar for rising trends.',
  },
  scriptorium: {
    name: 'The Scriptorium',
    description: 'Candlelit halls where quests become design briefs.',
  },
  magetower: {
    name: 'Tower of Artifice',
    description: 'The mages forge artwork here with the image-spirits.',
  },
  gatehouse: {
    name: 'The Gatehouse',
    description: 'No design leaves the realm without the warden\'s inspection.',
  },
  council: {
    name: 'Hall of the Steward',
    description: 'Your seat. Decrees awaiting your seal are gathered here.',
  },
  market: {
    name: 'The Grand Market',
    description: 'Each stall is a live listing. Banners glow as wares sell.',
  },
  treasury: {
    name: 'The Treasury',
    description: 'Where the gold of the realm is counted.',
  },
  oracle: {
    name: 'Spire of the Seer',
    description: 'The seer studies the sales ledgers once a day, or whenever you ask.',
  },
  rookery: {
    name: 'The Rookery',
    description: 'Ravens bearing customer messages roost here.',
  },
};

export interface NicheSeed {
  name: string;
  theme: string;
  keywords: string[];
  demand: number;
  competition: number;
  styles: DesignStyle[];
  phrases: string[];
}

export const NICHES: NicheSeed[] = [
  { name: 'Cottagecore Mushrooms', theme: 'mushroom', keywords: ['cottagecore', 'mushroom', 'forest', 'fairy'], demand: 0.72, competition: 0.55, styles: ['botanical', 'lineart', 'retro'], phrases: ['Stay Wild', 'Fungi Friend', 'Forage On'] },
  { name: 'Retro Camping', theme: 'camping', keywords: ['camping', 'outdoors', 'retro', 'adventure'], demand: 0.8, competition: 0.7, styles: ['badge', 'retro'], phrases: ['Not All Who Wander', 'Camp Vibes', 'Into The Wild'] },
  { name: 'Dark Academia Books', theme: 'books', keywords: ['bookish', 'dark academia', 'reader', 'library'], demand: 0.76, competition: 0.62, styles: ['typography', 'lineart', 'celestial'], phrases: ['One More Chapter', 'Bookish', 'Read Dangerously'] },
  { name: 'Celestial Tarot', theme: 'moon', keywords: ['tarot', 'celestial', 'moon', 'witchy'], demand: 0.68, competition: 0.58, styles: ['celestial', 'lineart'], phrases: ['The Moon', 'Star Child', 'Trust The Universe'] },
  { name: 'Frog Enthusiasts', theme: 'frog', keywords: ['frog', 'cute', 'pond', 'goblincore'], demand: 0.6, competition: 0.35, styles: ['retro', 'botanical', 'badge'], phrases: ['Hop To It', 'Pond Life', 'Ribbit'] },
  { name: 'Gardening Puns', theme: 'plant', keywords: ['gardening', 'plant mom', 'pun', 'gardener'], demand: 0.7, competition: 0.5, styles: ['typography', 'botanical'], phrases: ['Plant Lady', 'Lettuce Romaine Calm', 'Grow Through It'] },
  { name: 'Mountain Hiking', theme: 'mountain', keywords: ['hiking', 'mountain', 'trail', 'nature'], demand: 0.74, competition: 0.66, styles: ['badge', 'lineart', 'retro'], phrases: ['The Mountains Are Calling', 'Hike More', 'Trail Life'] },
  { name: 'Minimalist Botanicals', theme: 'leaf', keywords: ['botanical', 'minimalist', 'wall art', 'line art'], demand: 0.82, competition: 0.78, styles: ['lineart', 'botanical'], phrases: ['Bloom', 'Wildflower', 'Grow'] },
  { name: 'Spooky Cute Halloween', theme: 'ghost', keywords: ['halloween', 'spooky', 'cute ghost', 'autumn'], demand: 0.88, competition: 0.72, styles: ['retro', 'typography', 'badge'], phrases: ['Stay Spooky', 'Boo Crew', 'Spooky Season'] },
  { name: 'Cozy Coffee & Rain', theme: 'coffee', keywords: ['coffee', 'cozy', 'rainy day', 'hygge'], demand: 0.66, competition: 0.48, styles: ['typography', 'lineart', 'retro'], phrases: ['But First Coffee', 'Rainy Days', 'Cozy Season'] },
  { name: 'Fishing Grandpas', theme: 'fish', keywords: ['fishing', 'grandpa', 'lake', 'father day'], demand: 0.64, competition: 0.42, styles: ['badge', 'retro'], phrases: ['Reel Cool Grandpa', 'Gone Fishin', 'Lake Life'] },
  { name: 'Axolotl Lovers', theme: 'axolotl', keywords: ['axolotl', 'kawaii', 'cute', 'aquatic'], demand: 0.55, competition: 0.3, styles: ['retro', 'badge'], phrases: ['Axolotl Questions', 'Smile', 'Stay Weird'] },
  { name: 'Cat Witches', theme: 'cat', keywords: ['black cat', 'witch', 'cat mom', 'magic'], demand: 0.78, competition: 0.64, styles: ['celestial', 'lineart', 'typography'], phrases: ['Witchy Cat', 'Purrfect Spell', 'Cat Coven'] },
  { name: 'Beekeeping', theme: 'bee', keywords: ['bee', 'honey', 'beekeeper', 'save the bees'], demand: 0.58, competition: 0.38, styles: ['botanical', 'badge', 'lineart'], phrases: ['Bee Kind', 'Save The Bees', 'Honey Hive'] },
  { name: 'Teacher Appreciation', theme: 'apple', keywords: ['teacher', 'school', 'teacher gift', 'classroom'], demand: 0.84, competition: 0.8, styles: ['typography', 'retro'], phrases: ['Teach Love Inspire', 'Teacher Life', 'Little Minds'] },
];

export const PALETTES: string[][] = [
  ['#2d3a2e', '#e9d8a6', '#bb3e03', '#94d2bd'],
  ['#1b263b', '#e0e1dd', '#fca311', '#778da9'],
  ['#3d2c2e', '#f4e9cd', '#9dbebb', '#468189'],
  ['#2b2d42', '#edf2f4', '#ef233c', '#8d99ae'],
  ['#283618', '#fefae0', '#dda15e', '#606c38'],
  ['#22223b', '#f2e9e4', '#c9ada7', '#9a8c98'],
  ['#3a0ca3', '#f1faee', '#f72585', '#4cc9f0'],
  ['#432818', '#ffe6a7', '#bb9457', '#99582a'],
];

export interface ProductTypeInfo {
  price: number;
  cost: number;
  conversion: number;
}

export const PRODUCT_TYPES: Record<ProductType, ProductTypeInfo> = {
  'T-Shirt': { price: 24.99, cost: 13.5, conversion: 0.022 },
  Hoodie: { price: 44.99, cost: 27.0, conversion: 0.012 },
  Mug: { price: 18.99, cost: 9.2, conversion: 0.026 },
  Poster: { price: 21.99, cost: 10.5, conversion: 0.02 },
  'Tote Bag': { price: 22.99, cost: 12.0, conversion: 0.018 },
  Sticker: { price: 4.99, cost: 1.9, conversion: 0.045 },
};

export const AGENT_NAMES: Record<Role, string[]> = {
  scout: ['Haldor', 'Elowen', 'Faramund', 'Tarin', 'Sylvi', 'Brannoc'],
  scribe: ['Quillon', 'Ivo', 'Marigold', 'Penrith', 'Odelia', 'Ansel'],
  mage: ['Aldaron', 'Morwen', 'Thalindra', 'Ysolde', 'Gorvath', 'Elric'],
  warden: ['Borin', 'Hesk', 'Gundrid', 'Tormund', 'Rhea', 'Calder'],
  merchant: ['Barliman', 'Rosa', 'Fennick', 'Della', 'Otho', 'Juniper'],
  oracle: ['Isendra', 'Varda', 'Oloth', 'Seren'],
  herald: ['Pip', 'Wren', 'Corvin', 'Lark', 'Tobin', 'Nell'],
};

export const CUSTOMERS = [
  'Amelia from Ohio', 'Jonas from Hamburg', 'Priya from Leeds', 'Sam from Austin', 'Chloé from Lyon',
  'Mateo from Madrid', 'Hannah from Toronto', 'Liam from Dublin', 'Yuki from Osaka', 'Grace from Sydney',
];

export const RAVEN_MESSAGES: { message: string; reply: string }[] = [
  { message: 'Hi! Does this run true to size? I usually wear a medium.', reply: 'Hello! Yes, it fits true to size. A medium should be perfect. If you like a looser fit, size up one. Thank you for asking!' },
  { message: 'My order hasn\'t arrived yet, it\'s been 9 days. Any update?', reply: 'I\'m sorry for the wait! Each item is printed to order, so delivery can take a little longer. I\'ve checked your tracking and it\'s on its way. You should have it within a few days.' },
  { message: 'Can I get this design on a different colour shirt?', reply: 'Absolutely! I can make this available in another colour. Tell me which one you\'d like and I\'ll set up a custom listing for you.' },
  { message: 'I love it!! Bought it as a gift and my sister cried :)', reply: 'This made my whole day, thank you so much for sharing! I\'m so glad your sister loved it.' },
  { message: 'The print on my mug has a small smudge. Can you help?', reply: 'I\'m so sorry about that! Please send a photo and I\'ll arrange a free replacement right away.' },
  { message: 'Do you offer bulk discounts? I need 20 for my book club.', reply: 'How lovely! Yes, I can offer 15% off orders of 10 or more. I\'ll create a custom listing for your book club.' },
];

/** World-space positions (x, z) of each building. Shared by the engine (walk times) and the 3D world. */
export const LAYOUT: Record<BuildingId, { x: number; z: number }> = {
  council: { x: 0, z: 0 },
  watchtower: { x: -28, z: -20 },
  scriptorium: { x: -30, z: 8 },
  magetower: { x: -14, z: 28 },
  gatehouse: { x: 12, z: 28 },
  market: { x: 30, z: 6 },
  treasury: { x: 14, z: -14 },
  oracle: { x: -4, z: -32 },
  rookery: { x: 30, z: -22 },
};

/** Where caravans leave the realm (the print partner ships the order). */
export const REALM_EXIT = { x: 80, z: 14 };
