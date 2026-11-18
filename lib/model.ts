// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// pre-token protocol below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures, and the base multiple is no longer a
// house constant: it is the category's own comparable. For each category, take the live-token protocols
// in that category in this same snapshot and use the median of their market-cap / TVL ratios. A
// pre-token DEX is worth what live DEXs trade at per dollar of TVL; a pre-token lender is worth what
// live lenders trade at. Categories with fewer than three live comparables fall back to the global
// median across all live protocols. The multiple is clamped to a sane band so one outlier category
// cannot price a protocol at fantasy or at nothing.
//
//   comparable = median(mcap_usd / tvl_usd) over the category's live protocols (n >= 3),
//                else the global median; clamped to [comparable_floor, comparable_cap]
//   base       = tvl_usd x comparable
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   chainMult  = 1 + min(max(chains - 1, 0), 10) x CHAIN_STEP
//   implied    = max(1, round(base x growthMult x maturity x chainMult))
//
// The comparable multiple is rounded to four decimals when it is scored, so the dashboard's
// recomputation lands on the same number the board carries.
//
// Age is the time since first listing: how long the protocol has run with no token. Chain breadth is a
// small premium for distribution across chains, capped so a protocol on forty chains does not outrank
// its own TVL. No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  comparable_floor: number;
  comparable_cap: number;
  comparable_min_n: number;
  chain_step: number;
  chain_max: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  comparable_floor: 0.05,
  comparable_cap: 1.5,
  comparable_min_n: 3,
  chain_step: 0.02,
  chain_max: 10,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comparable_multiple: number;
    comparable_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
  /** The row's derivation as a sentence, for the detail view. */
  explanation: string;
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  comparable_multiple: number;
  comparable_n: number;
  chain_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  /** The row's derivation as a sentence, for the detail view. */
  explanation: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  /** The market-cap / TVL ratio this protocol itself trades at: the comparable its category is priced from. */
  ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  /** The watchlist's slugs, so the page can filter to the watchlist alone. */
  watchlist_slugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  global_comparable: number;
  /** The board grouped by category, richest first, for the dashboard's category table. */
  categories: CategoryStat[];
  /** How the comparables themselves spread, for the model panel. */
  comparable_stats: ComparableStats;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted list of numbers; the middle value, or the mean of the middle two. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One category's comparable multiple and how many live protocols priced it. */
export interface Comparable {
  multiple: number;
  n: number;
}

/** The comparables table: every category's multiple, plus the global fallback, from this snapshot. */
export interface Comparables {
  global: number;
  byCategory: Map<string, Comparable>;
}

/**
 * The live-token protocols' own market-cap / TVL ratios, grouped by category. A live protocol counts
 * as a comparable only when it trades (a market cap), holds value (TVL above zero), is not an exchange
 * and is not a versioned pool of another protocol. The global median is the fallback for categories
 * with too few comparables to price themselves.
 */
export function buildComparables(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX' || VERSIONED.test(p.name)) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio)) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = all.length > 0 ? round4(clampMedian(median(all), model)) : 0.25;
  const table = new Map<string, Comparable>();
  for (const [category, ratios] of byCategory) {
    if (ratios.length >= model.comparable_min_n) {
      table.set(category, { multiple: round4(clampMedian(median(ratios), model)), n: ratios.length });
    }
  }
  return { global, byCategory: table };
}

/** A median multiple inside the model's band. */
function clampMedian(value: number, model: ModelConstants): number {
  return Math.min(model.comparable_cap, Math.max(model.comparable_floor, value));
}

/** A protocol's comparable multiple: its category's, or the global fallback when the category is thin. */
export function comparableFor(p: SnapshotProtocol, comparables: Comparables): Comparable {
  const key = p.category ?? 'Other';
  const own = comparables.byCategory.get(key);
  if (own !== undefined) return own;
  return { multiple: comparables.global, n: 0 };
}

/** A dollar figure as the explanation writes it: $2.75B, $543.6M, $214.2M. */
function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** An age in days as the explanation writes it: 1.5y, 45d, unknown. */
function fmtAge(days: number | null): string {
  if (days === null) return 'unknown';
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  return `${Math.max(0, Math.round(days))}d`;
}

/** One row's derivation as a sentence: the arithmetic the detail view shows, in words. */
export function explainRow(row: BoardRow): string {
  const m = row.model;
  const growth = m.growth_pct >= 0 ? `+${m.growth_pct}%` : `${m.growth_pct}%`;
  const chains = `${row.chains.length} chain${row.chains.length === 1 ? '' : 's'}`;
  return `${fmtUsd(row.tvl_usd)} of TVL x ${m.comparable_multiple} comparable x ${m.growth_multiplier} growth (${growth} over 7 days) x ${m.maturity_multiplier} maturity (${fmtAge(m.age_days)} with no token) x ${m.chain_multiplier} chain (${chains}) = ${fmtUsd(row.implied_value_usd)}.`;
}

/** One category's share of the board: how many rows, what multiple priced them, what they are worth together. */
export interface CategoryStat {
  category: string;
  rows: number;
  watchlist_rows: number;
  comparable_multiple: number;
  comparable_n: number;
  total_implied_usd: number;
  top_slug: string;
  top_name: string;
}

/** The board grouped by category, richest first: the dashboard's category table. */
export function categoryBreakdown(board: BoardRow[], watchlist: string[]): CategoryStat[] {
  const byCat = new Map<string, BoardRow[]>();
  for (const r of board) {
    const key = r.category ?? 'Other';
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [r]);
    else list.push(r);
  }
  const watch = new Set(watchlist);
  const stats = [...byCat.entries()].map(([category, rows]) => {
    const sorted = [...rows].sort((a, b) => b.implied_value_usd - a.implied_value_usd);
    const top = sorted[0]!;
    return {
      category,
      rows: rows.length,
      watchlist_rows: rows.filter((r) => watch.has(r.slug)).length,
      comparable_multiple: top.model.comparable_multiple,
      comparable_n: top.model.comparable_n,
      total_implied_usd: rows.reduce((sum, r) => sum + r.implied_value_usd, 0),
      top_slug: top.slug,
      top_name: top.name,
    };
  });
  stats.sort((a, b) => b.total_implied_usd - a.total_implied_usd || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return stats;
}

/** How the comparables themselves spread: how many categories price themselves, and the range of multiples. */
export interface ComparableStats {
  categories_priced: number;
  categories_fallback: number;
  min_multiple: number;
  median_multiple: number;
  max_multiple: number;
}

/** The comparables' own summary, from the categories the board actually holds. */
export function comparableStats(board: BoardRow[], comparables: Comparables): ComparableStats {
  const seen = new Map<string, number>();
  for (const r of board) {
    const key = r.category ?? 'Other';
    if (!seen.has(key)) seen.set(key, r.model.comparable_multiple);
  }
  const multiples = [...seen.values()].sort((a, b) => a - b);
  const priced = [...seen.keys()].filter((c) => comparables.byCategory.has(c)).length;
  return {
    categories_priced: priced,
    categories_fallback: seen.size - priced,
    min_multiple: multiples[0] ?? comparables.global,
    median_multiple: multiples.length > 0 ? median(multiples) : comparables.global,
    max_multiple: multiples[multiples.length - 1] ?? comparables.global,
  };
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  comparables: Comparables,
): { implied: number; comparable: Comparable; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const comparable = comparableFor(protocol, comparables);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainCount = protocol.chains.length;
  const chainMult = 1 + Math.min(Math.max(chainCount - 1, 0), model.chain_max) * model.chain_step;
  const base = protocol.tvl_usd * comparable.multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, comparable, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comparables = buildComparables(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, by TVL. No cap: the
  // board is the watchlist plus the whole early set, 226 rows in this snapshot, and a protocol the
  // radar leaves out is a protocol it never looked at. Never a replacement for a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, comparable, growthPct, growthMult, maturityMult, chainMult, age } = impliedValue(p, snapshot.as_of, model, comparables);
    return { p, implied, comparable, growthPct, growthMult, maturityMult, chainMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const rows: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      comparable_multiple: round4(s.comparable.multiple),
      comparable_n: s.comparable.n,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    explanation: '',
  }));
  // The derivation sentence needs the finished row, so it is attached in a second pass.
  for (const r of rows) r.explanation = explainRow(r);
  return rows;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A gas figure in dollars: the chain decides it, so the same action costs $8 on Ethereum and $0.10 on Solana. */
function gasFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8;
  if (c === 'solana') return 0.1;
  if (c === 'tron') return 1;
  const cheap = ['arbitrum', 'optimism', 'base', 'zksync era', 'polygon', 'blast', 'linea', 'scroll', 'mode', 'ink', 'unichain', 'zora', 'starknet', 'mantle', 'fraxtal', 'berachain', 'abstract', 'soneium', 'world chain'];
  if (cheap.includes(c)) return 0.5;
  return 2;
}

/** A dollar figure as the farm plan writes it: $8, $2, $0.50, $0.10. */
function fmtGas(n: number): string {
  return n >= 1 ? `$${n}` : `$${n.toFixed(2)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly action that keeps a position qualifying, by category: a lender is farmed by borrowing, a DEX by swapping. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Borrow a small amount against the supply and repay it the same week.';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'Swap a small amount through the main pool, or add and remove a little liquidity.';
  if (c.includes('bridge')) return 'Bridge a small amount to another chain and back.';
  if (c.includes('staking') || c.includes('restak')) return 'Claim or compound the staking rewards, and check the receipt is still live.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Open and close one small hedge.';
  if (c.includes('prediction')) return 'Place one small market position.';
  if (c.includes('curator') || c.includes('allocator')) return 'Check the vault allocation and rebalance if it moved.';
  if (c.includes('stable')) return 'Mint or redeem a small amount of the stable asset.';
  if (c.includes('rwa')) return 'Check the yield asset accrues and claim what is due.';
  if (c.includes('insurance')) return 'Check the policy is still active and the cover amount is right.';
  return 'Make one qualifying action, such as a deposit, a swap or a vote.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about ${fmtGas(gas)} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about ${fmtGas(gas)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyActionFor(p),
      cost: `about ${fmtGas(gas)} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1e4) / 1e4 : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    comparable_multiple: row.model.comparable_multiple,
    comparable_n: row.model.comparable_n,
    chain_count: row.chains.length,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    explanation: row.explanation,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comparables = buildComparables(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_comparable: round4(comparables.global),
    categories: categoryBreakdown(board, snapshot.watchlist),
    comparable_stats: comparableStats(board, comparables),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
