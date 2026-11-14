// lib/model.ts — the token launch radar's value model and farm-plan generator.
//
// The radar reads one sealed snapshot of the DeFi protocol universe and answers two
// questions for every protocol that records no token yet: what would a token be
// worth if it were priced the way the market already prices its tokenized peers,
// and what should a farmer concretely do about it before launch day.
//
// THE VALUE MODEL (no name is ever special-cased; the snapshot's own figures decide)
//
//   Peers. Protocols whose token already trades (mcap_usd present) reveal how the
//   market prices one dollar of TVL in their line of business:
//       ratio = mcap_usd / tvl_usd
//   Ratios outside [0.02, 30] are discarded as broken records. A category with at
//   least 3 surviving peers contributes its MEDIAN ratio; any other category falls
//   back to the global median ratio across all surviving peers.
//
//   For a pre-token protocol (gecko_id, symbol and mcap_usd all null):
//       implied = tvl_usd x categoryRatio x momentum x maturity x breadth
//       momentum = clamp(1 + change_7d / 100, 0.7, 1.6)   (change_7d null -> 1.0)
//       maturity = 0.8 + 0.1 x min(age in years, 4)       (listed_at null -> 0.9)
//       breadth  = min(1 + 0.03 x (chains - 1), 1.15)
//       implied_value_usd = max(1, round(implied))
//   Momentum pays for a TVL curve that is still rising and discounts one in
//   retreat; maturity pays for years survived tokenless (a protocol the market
//   has watched for longer supports a fuller pricing); breadth pays a small
//   premium for each extra chain the protocol already operates on.
//
//   Rows are ranked by implied value, rank 1 highest. Rounded values can tie;
//   a tie is broken by subtracting the row's own index in dollars from the tied
//   value (never below 1), so values strictly decrease down the board while the
//   ordering still follows the unrounded model exactly.
//
//   SET APART, NEVER RANKED. Recording no token fields is not the same as being
//   a candidate for a first token. A pre-token protocol whose product already
//   IS a token that trades in another form — a bridge or wrapped form of it, a
//   staking or restaking receipt for it, an exchange's own product, or one
//   version of another protocol's product — is not priced or ranked at all: it
//   joins the tokenized protocols in the set-apart table, shown with the
//   reason it is set apart (see setApartReason). The pricing above is untouched
//   by this rule; it only decides which protocols the board ranks.
//
// FARM PLANS are generated per row from the protocol's category family, woven
// with its own name, chains, TVL and 7-day change: five steps each, every step
// carrying a concrete action, a typical cost and a duration.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label, stated on the dashboard. */
export const MODEL_VERSION = 'peer-ratio-3';

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whole days from listed_at to the snapshot's as_of; null when either date is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The peer table the model prices from: per-category median ratios and the global fallback. */
export interface PeerTable {
  global_ratio: number;
  peer_count: number;
  by_category: Map<string, { ratio: number; peers: number }>;
}

const RATIO_MIN = 0.02;
const RATIO_MAX = 30;
const MIN_CATEGORY_PEERS = 3;

/** Build the peer table from the snapshot's tokenized protocols. */
export function buildPeerTable(snapshot: Snapshot): PeerTable {
  const kept: { category: string | null; ratio: number }[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < RATIO_MIN || ratio > RATIO_MAX) continue;
    kept.push({ category: p.category, ratio });
  }
  if (kept.length === 0) throw new SnapshotError('snapshot carries no usable tokenized peers');
  const byCategory = new Map<string, { ratio: number; peers: number }>();
  const grouped = new Map<string, number[]>();
  for (const k of kept) {
    if (k.category === null) continue;
    const list = grouped.get(k.category) ?? [];
    list.push(k.ratio);
    grouped.set(k.category, list);
  }
  for (const [category, ratios] of grouped) {
    if (ratios.length >= MIN_CATEGORY_PEERS) {
      byCategory.set(category, { ratio: median(ratios), peers: ratios.length });
    }
  }
  return { global_ratio: median(kept.map((k) => k.ratio)), peer_count: kept.length, by_category: byCategory };
}

/** The four model factors for one pre-token protocol, before rounding. */
export interface Factors {
  category_ratio: number;
  ratio_basis: 'category' | 'global';
  ratio_peers: number;
  momentum: number;
  maturity: number;
  breadth: number;
  age_years: number | null;
}

/** Score one pre-token protocol: its factors and its unrounded implied value. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, peers: PeerTable): { raw: number; factors: Factors } {
  const entry = p.category !== null ? peers.by_category.get(p.category) : undefined;
  const categoryRatio = entry !== undefined ? entry.ratio : peers.global_ratio;
  const momentum = p.change_7d === null ? 1.0 : clamp(1 + p.change_7d / 100, 0.7, 1.6);
  const days = ageDays(asOf, p.listed_at);
  const ageYears = days === null ? null : days / 365.25;
  const maturity = ageYears === null ? 0.9 : 0.8 + 0.1 * Math.min(ageYears, 4);
  const breadth = Math.min(1 + 0.03 * (p.chains.length - 1), 1.15);
  const raw = p.tvl_usd * categoryRatio * momentum * maturity * breadth;
  return {
    raw,
    factors: {
      category_ratio: round4(categoryRatio),
      ratio_basis: entry !== undefined ? 'category' : 'global',
      ratio_peers: entry !== undefined ? entry.peers : peers.peer_count,
      momentum: round4(momentum),
      maturity: round4(maturity),
      breadth: round4(breadth),
      age_years: ageYears === null ? null : round4(ageYears),
    },
  };
}

// ---------------------------------------------------------------- farm plans

/** The template family a category belongs to; plans differ by family, never by name. */
export type FarmFamily =
  | 'dexs' | 'lending' | 'yield' | 'derivatives' | 'bridge'
  | 'liquid-staking' | 'stable' | 'rwa' | 'curator' | 'exchange' | 'other';

export function farmFamily(category: string | null): FarmFamily {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('liquidity manager')) return 'dexs';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('interest rate')) return 'lending';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('staking pool') || c.includes('restak') || c.includes('anchor btc') || c.includes('decentralized btc')) return 'liquid-staking';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option') || c.includes('synthetic')) return 'derivatives';
  if (c.includes('stable') || c.includes('reserve currency')) return 'stable';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('cex') || c.includes('cedefi')) return 'exchange';
  if (c.includes('yield') || c.includes('farm') || c.includes('basis')) return 'yield';
  return 'other';
}

/** Compact dollars for prose: $1.25B, $340M, $85K. */
export function compactUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

/** A sensible starter position for a protocol of this size, in dollars. */
function positionFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 300;
  if (tvl >= 250_000_000) return 200;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** How long a position should run, from how long the protocol has been tracked. */
function holdWeeks(days: number | null): number {
  if (days === null) return 6;
  if (days < 180) return 10;
  if (days < 540) return 8;
  return 6;
}

const FAMILY_ACTION: Record<FarmFamily, (name: string, chain: string, pos: number) => string> = {
  dexs: (n, ch, pos) => `Add $${pos} of liquidity to ${n}'s busiest stablecoin or blue-chip pool on ${ch}, split evenly on both sides, and keep the LP position open rather than hopping pools.`,
  lending: (n, ch, pos) => `Supply $${pos} of USDC to ${n} on ${ch}, then borrow about 30% against it and re-supply the loan once, so both the supply and borrow sides of your account register activity.`,
  yield: (n, ch, pos) => `Deposit $${pos} into ${n}'s main vault on ${ch} and leave the shares untouched; if the vault issues a receipt token, keep it in the same wallet so the holding is attributable.`,
  derivatives: (n, ch, pos) => `Deposit $${pos} of USDC margin on ${n} via ${ch} and run a small hedged book: one long and one short of equal size, rebalanced weekly, so volume accrues without directional risk.`,
  bridge: (n, ch, pos) => `Bridge $${pos} of USDC through ${n} onto ${ch}, then put the bridged funds to work in one app on the far side instead of bridging straight back; repeat from a second source chain in a later week if ${n} supports one.`,
  'liquid-staking': (n, ch, pos) => `Stake $${pos} of the native asset through ${n} on ${ch} and hold the liquid staking receipt in your wallet; do not sell or loop it during the qualifying window.`,
  stable: (n, ch, pos) => `Mint or deposit $${pos} of ${n}'s stable asset on ${ch} and hold it in your wallet; if a savings wrapper exists, hold the wrapped form so yield and balance both show.`,
  rwa: (n, ch, pos) => `Mint $${pos} of ${n}'s yield-bearing asset on ${ch} and hold it to maturity of at least one full payout cycle, keeping the mint transaction in your main farm wallet.`,
  curator: (n, ch, pos) => `Deposit $${pos} into a ${n} curated vault on ${ch} with a clean risk record, and keep the vault shares; curators distribute partner rewards to depositors who stay through snapshots.`,
  exchange: (n, ch, pos) => `Fund a ${n} account with $${pos}, route a modest share of your usual spot trades through it each week, and keep a small resting balance on the venue between sessions.`,
  other: (n, ch, pos) => `Deposit $${pos} of USDC into ${n}'s core product on ${ch} and keep the position open; if it offers several products, use the flagship one that its own front page leads with.`,
};

const FAMILY_CADENCE: Record<FarmFamily, string> = {
  dexs: 'make one small swap through the same pool each week so the wallet reads as a returning trader, not a one-off depositor',
  lending: 'repay and re-borrow a small slice once a week so both sides of the market see regular, organic activity',
  yield: 'claim and re-deposit any harvested rewards once a week, and top the position up by a few dollars so the balance trends upward',
  derivatives: 'trade one small hedged pair each week to keep weekly volume steady; never let a liquidation print on the account',
  bridge: 'bridge a small amount in each direction once a week, varying the asset and the hour so the pattern reads as real usage',
  'liquid-staking': 'add a small top-up stake every week and claim rewards on the protocol\u2019s own schedule, keeping the receipt balance always rising',
  stable: 'move a small amount in or out once a week and hold through the weekly snapshot if the protocol publishes one',
  rwa: 'check the position weekly and roll it into the next payout cycle before the current one matures, so coverage never lapses',
  curator: 'review the vault\u2019s allocation weekly and add a small top-up; curators notice depositors who stay through rebalances',
  exchange: 'place two or three real trades a week and withdraw only part of any profit, leaving the account visibly active',
  other: 'repeat the core action in a smaller size once a week, at a different hour each time, so the wallet shows a steady usage rhythm',
};

/**
 * Five concrete farm steps for one protocol, woven from its own record. Every step
 * names an action, a typical cost and a duration; lengths sit inside the gate's
 * 20..600 trimmed characters with room to spare.
 */
export function farmSteps(p: SnapshotProtocol, days: number | null): string[] {
  const family = farmFamily(p.category);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const chainNote = p.chains.length > 1 ? ` (it runs on ${p.chains.length} chains; ${chain} is the deepest)` : '';
  const pos = positionFor(p.tvl_usd);
  const weeks = holdWeeks(days);
  const change = p.change_7d === null ? 'not reported this week' : `${p.change_7d >= 0 ? 'up' : 'down'} ${Math.abs(p.change_7d).toFixed(1)}% in seven days`;
  // Gas bands follow the chain the farmer actually pays on: Bitcoin and Ethereum
  // mainnet are priced in dollars, most other chains in cents.
  const gas = chain === 'Ethereum' ? '$6\u2013$15' : chain === 'Bitcoin' ? '$3\u2013$12' : '$0.10\u2013$2';
  return [
    `Set up a fresh wallet for ${p.name} only, fund it with the position plus a gas buffer on ${chain}, and save the address in your farm log. Cost: ${gas} of gas to fund. Time: 10 minutes, once.`,
    `${FAMILY_ACTION[family](p.name, chain, pos)} ${p.name} holds ${compactUsd(p.tvl_usd)} of TVL, ${change}. Cost: $${pos} of capital plus about ${gas} of gas. Time: 15\u201320 minutes to set up.`,
    `Build a weekly rhythm on ${chain}${chainNote}: ${FAMILY_CADENCE[family]}. Cost: about ${gas} of gas a week. Time: 10 minutes a week for about ${weeks} weeks.`,
    `Hold the position for at least ${weeks} weeks so it appears in several weekly snapshots, and join ${p.name}\u2019s official community channels and governance forum with the same wallet where it supports votes. Cost: the $${pos} stays deployed. Time: ${weeks} weeks of holding, 5 minutes a week of reading.`,
    `Each Friday, record TVL, your balance and any points ${p.name} shows in your farm log, and check the protocol\u2019s own announcements before acting on rumours; never pay a third party to \u201cclaim\u201d anything. Cost: nothing. Time: 5 minutes a week, and 15 minutes to unwind cleanly if you exit.`,
  ];
}

// ------------------------------------------------------- set apart, unranked

/**
 * Categories whose product is a token that already trades in another form, or an
 * exchange's own venue: never a candidate for a first token, whatever the
 * snapshot's token fields say. Mirrors the watchlist's product exclusions, with
 * no TVL condition.
 */
const SET_APART_CATEGORY_REASONS: ReadonlyMap<string, string> = new Map([
  ['Bridge', 'wrapped or bridged product of a token that already trades'],
  ['Canonical Bridge', 'wrapped or bridged product of a token that already trades'],
  ['Liquid Staking', 'staking product'],
  ['Liquid Restaking', 'staking product'],
  ['Restaked BTC', 'staking product'],
  ['CEX', 'exchange product'],
]);

/** A name that ends in a version marker: "Aera V3", "Metric v1.2", "Pool 2.0". */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole-word product markers: a wrapped form is not a new asset, a staked form is a receipt. */
const WRAPPED_WORD = /\bwrapped\b/i;
const STAKING_WORD = /\b(staked|staking)\b/i;

/** A name that opens with a centralised exchange's brand is that exchange's product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

const REASON_WRAPPED = 'wrapped or bridged product of a token that already trades';
const REASON_STAKING = 'staking product';
const REASON_EXCHANGE = 'exchange product';
const REASON_VERSIONED = 'versioned product of another protocol';

/**
 * Why a pre-token protocol is set apart from the ranking instead of priced, or
 * null when it is a genuine candidate for a first token. The checks run in a
 * fixed order — category, version marker, product word, exchange brand — so the
 * stated reason is deterministic. No TVL condition applies: a small bridge is
 * as much a product of a trading token as a large one.
 */
export function setApartReason(p: SnapshotProtocol): string | null {
  if (p.category !== null) {
    const reason = SET_APART_CATEGORY_REASONS.get(p.category);
    if (reason !== undefined) return reason;
  }
  if (VERSION_SUFFIX.test(p.name)) return REASON_VERSIONED;
  if (WRAPPED_WORD.test(p.name)) return REASON_WRAPPED;
  if (STAKING_WORD.test(p.name)) return REASON_STAKING;
  if (EXCHANGE_PREFIX.test(p.name)) return REASON_EXCHANGE;
  return null;
}

// ---------------------------------------------------------------- the board

/** One row of board.json, and of the dashboard's data. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: Factors;
  farm_steps: string[];
}

/**
 * A protocol kept apart from the ranked board. Tokenized protocols carry the
 * market's own value (mcap_usd and ratio set, set_apart_reason null). Pre-token
 * protocols the ranking sets apart carry no model value either: mcap_usd and
 * ratio are null and set_apart_reason states why they are not ranked.
 */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
  set_apart_reason: string | null;
}

/** The model summary the dashboard states at the top of the page. */
export interface ModelSummary {
  version: string;
  formula: string;
  peer_count: number;
  global_ratio: number;
  categories_priced: number;
}

/** Everything written to data.js as window.BOARD_DATA. */
export interface BoardData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelSummary;
  protocol_count: number;
  pre_token_count: number;
  set_apart_count: number;
  tokenized_count: number;
  watchlist_size: number;
  board_size: number;
  total_implied_usd: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Rank every pre-token protocol in the snapshot by implied value, setting apart those whose product already trades in another form. */
export function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; summary: ModelSummary; live: LiveRow[]; peers: PeerTable; setApart: LiveRow[] } {
  const peers = buildPeerTable(snapshot);
  const watch = new Set(snapshot.watchlist);
  const candidates: SnapshotProtocol[] = [];
  const setApart: LiveRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const reason = setApartReason(p);
    if (reason === null) {
      candidates.push(p);
    } else {
      setApart.push({
        slug: p.slug, name: p.name, category: p.category, chains: p.chains,
        tvl_usd: p.tvl_usd, mcap_usd: null, change_7d: p.change_7d,
        ratio: null, set_apart_reason: reason,
      });
    }
  }
  // The set-apart pre-token protocols sit below the tokenized ones, largest first.
  setApart.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const scored = candidates
    .map((p) => ({ p, ...scoreProtocol(p, snapshot.as_of, peers) }));
  // Order by the unrounded model, then TVL, then slug: fully deterministic.
  scored.sort((a, b) => b.raw - a.raw || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const rows: BoardRow[] = [];
  let prev = Number.POSITIVE_INFINITY;
  scored.forEach((s, i) => {
    let value = Math.max(1, Math.round(s.raw));
    if (value >= prev) value = Math.max(1, prev - (i + 1));
    prev = value;
    rows.push({
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: null,
      listed_at: s.p.listed_at,
      gecko_id: null,
      symbol: null,
      token_status: 'pre-token',
      watchlist: watch.has(s.p.slug),
      age_days: ageDays(snapshot.as_of, s.p.listed_at),
      implied_value_usd: value,
      model: s.factors,
      farm_steps: farmSteps(s.p, ageDays(snapshot.as_of, s.p.listed_at)),
    });
  });
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 36)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, change_7d: p.change_7d,
      ratio: round4(p.tvl_usd > 0 ? p.mcap_usd! / p.tvl_usd : 0),
      set_apart_reason: null,
    }))
    .concat(setApart);
  const summary: ModelSummary = {
    version: MODEL_VERSION,
    formula: 'implied = TVL x category median mcap/TVL (peers: tokenized protocols, ratios trimmed to [0.02, 30], category needs >= 3 peers else global median) x momentum clamp(1 + change_7d/100, 0.7, 1.6) x maturity (0.8 + 0.1 x min(age years, 4); unknown age 0.9) x breadth min(1 + 0.03 x (chains - 1), 1.15). Set apart unranked, with the reason stated: category Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX; a name ending in a version marker (V2, v1.2, 2.0); a name carrying the word wrapped, staked or staking; or a name opening with an exchange brand (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini)',
    peer_count: peers.peer_count,
    global_ratio: round4(peers.global_ratio),
    categories_priced: peers.by_category.size,
  };
  return { rows, summary, live, peers, setApart };
}

/** Assemble the full data.js payload. */
export function buildData(snapshot: Snapshot): BoardData {
  const { rows, summary, live, setApart } = buildBoard(snapshot);
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: summary,
    protocol_count: snapshot.protocols.length,
    pre_token_count: rows.length + setApart.length,
    set_apart_count: setApart.length,
    tokenized_count: snapshot.protocols.filter((p) => p.mcap_usd !== null).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    total_implied_usd: rows.reduce((sum, r) => sum + r.implied_value_usd, 0),
    rows,
    live,
  };
}

/** The data.js script text: one global, no fetch, no network. */
export function dataScript(data: BoardData): string {
  return `window.BOARD_DATA=${JSON.stringify(data)};\n`;
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows`;
  const slugs = new Set(rows.map((r) => r.slug));
  if (slugs.size !== rows.length) return 'a slug appears twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of rows) if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.rank !== i + 1) return `row ${i} carries rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (i > 0 && r.implied_value_usd >= rows[i - 1]!.implied_value_usd) return `row ${i + 1} does not sit below row ${i}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  if (rows.length >= 2 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  return null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
