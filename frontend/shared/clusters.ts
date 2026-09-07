/** Bunching recent employments into stories.
 *
 * The site already shows every new posting one card at a time, newest first
 * (`/api/edges/recentEmployments`). One card is a fact; what a reader wants is
 * the pattern behind it - „w Chełmie w dwa lata zmieniło się pół obsady spółek
 * miejskich, dziesięć osób z jednej partii”. Nothing on the site put those
 * twelve cards next to each other, so nobody could see it.
 *
 * This module is the arithmetic behind that: it takes the employments, groups
 * them on the keys a story actually has - a town, a branch of the economy, an
 * owner - and scores each group against what the rest of the country did in the
 * same period. It is deliberately free of Firestore: the computation is worth
 * testing on made up hires, and the endpoint that feeds it real ones
 * (`/api/stats/computeClusters`) has enough to do reading them.
 *
 * ## Why the ranking is not a count
 *
 * Three things confound a naive "which region had the most hires":
 *
 * 1. **Coverage.** Warsaw has 458 known hires in the last two years against
 *    Chełm's 24, and would win every list forever. Every statistic here is
 *    therefore relative to what the group's own volume predicts.
 * 2. **Crawl recency.** Employment starts per year run at ~750 through 2019-23
 *    and then 2,735 in 2024, 1,500 in 2025, 1,519 in 2026 - part of that is the
 *    April 2024 local elections and part is that the register always names a
 *    current board while a historical one needs an OdpisPełny. The share of
 *    spells carrying an `end_date` falls from 0.86 in 2016 to 0.02 in 2026,
 *    which is the same fact from the other side. So a group is never compared
 *    against *its own past*; it is compared against *the rest of the country in
 *    the same window*, where that trend is common to both sides and cancels.
 * 3. **Publication bias.** A group looks partisan partly because an editor has
 *    already worked it - the published half of the graph is not a sample of the
 *    whole. Detection therefore runs over every hire the graph knows about, and
 *    `visible` only decides what a logged out reader is shown afterwards.
 *
 * ## What counts as a cluster
 *
 * Three keys, each measured to produce story-shaped output on the real graph:
 *
 * - `region`: the company's seat region. The strongest of the three - Chełm
 *   comes out at p=1.2e-04 on party purity, Rzeszów at 4e-06.
 * - `sector`: the company's category, nationally. This is the „desant partii na
 *   branżę” shape - PiS holds 14 of the 26 party-carrying hires at wodociągi
 *   across 13 separate companies, which no regional key can see.
 * - `owner`: whoever owns the company, resolved through ownership chains. A
 *   holding is a story the map has no shape for.
 *
 * A crew - the same people recurring across several companies in one group - is
 * not a fourth key but a property of the other three. Linking hires by shared
 * company alone collapses into a single 76-hire component spanning Kraków and
 * Podhale; bounded inside a group it is the detail that makes the group legible.
 */

import { canonicalParty } from "./misc";

/** One employment spell, flattened into everything the arithmetic needs.
 *
 * Assembled by the caller, which is the only part that knows about Firestore.
 * Names travel with ids because a cluster document is read by a card that will
 * not fetch either endpoint again.
 */
export type ClusterHire = {
  /** The employment edge, which is what a reader would cite. */
  edgeId: string;
  personId: string;
  personName: string;
  /** Parties the person is filed under. Empty is common and means nothing was
   * learned, not that the person is unaffiliated - see `partyMix`. */
  parties: string[];
  companyId: string;
  companyName: string;
  /** The sectors the company is filed under, e.g. `["szpitale"]`. */
  categories: string[];
  /** The region the company is registered in, as a node id (`teryt0662`). */
  regionId?: string;
  regionName?: string;
  /** Everyone who owns the company, ownership chains already resolved, as node
   * ids. Both regions and companies appear here: a gmina owning its wodociągi
   * and PKP owning PKP Intercity are the same relation to a reader. */
  ownerIds?: string[];
  /** What kind of body owns the company, at its most local: a gmina, a powiat,
   * a województwo, the state, another company, or nothing recorded.
   *
   * The stratum every rate in this module is measured within, and the single
   * most important correction in it. „Gmina-owned companies hire the party that
   * runs the gmina” is true, unremarkable, and enough on its own to produce
   * findings at p=6e-09: stratifying on the owner tier takes PO at wodociągi
   * from 6.3e-09 to 0.073, and does the same to three other cells that looked
   * like sector capture. The same applies to local candidacy, where a gmina's
   * companies draw from a pool of people who have stood for election in that
   * gmina and a ministry's do not. */
  ownerTier?: OwnerTier;
  /** The role as the edge names it - „Zarząd”, „Rada Nadzorcza”. */
  role?: string | null;
  /** ISO `YYYY-MM-DD`. A spell with no start date cannot be placed in a window
   * and never reaches this module. */
  start: string;
  /** The person's birth date, where anybody recorded one. Only ever read to
   * refuse a merge: two pages whose names differ by a middle name are the same
   * human unless their birth dates say otherwise. */
  birthDate?: string;
  /** The company's KRS number, which is the one identifier that settles whether
   * two place nodes are the same company. */
  companyKrs?: string;
  /** Whether a logged out reader may open all of it: the edge is published and
   * so are both endpoints. Detection ignores this; presentation does not. */
  visible: boolean;
  /** Whether the person stood for election in this company's seat region.
   *
   * The single most story-shaped fact available - eight of Chełm's twelve
   * visible hires have it - and the one that separates „a local was hired” from
   * „the person who ran on that list here was hired”. */
  localCandidate: boolean;
};

export type ClusterKind = "region" | "sector" | "owner";

/** The four ways a group can earn a place on the list. */
export type ClusterChannel = "party" | "burst" | "sweep" | "local";

/** The kinds of body that own a company, coarsest last. `spolka` is a company
 * owned by another company; `brak` is one the register gives no owner for. */
export const ownerTiers = [
  "gmina",
  "powiat",
  "wojewodztwo",
  "panstwo",
  "spolka",
  "brak",
] as const;

export type OwnerTier = (typeof ownerTiers)[number];

/** A person holding seats at more than one company inside the cluster. */
export type ClusterCrewMember = {
  personId: string;
  personName: string;
  /** How many of the cluster's companies they hold a seat at. Always >= 2. */
  companies: number;
  parties: string[];
};

/** One hire as a cluster card lists it. A trimmed `ClusterHire`: the card names
 * the person, the company and the day, and links to both. */
export type ClusterHireRef = {
  edgeId: string;
  personId: string;
  personName: string;
  parties: string[];
  companyId: string;
  companyName: string;
  role?: string | null;
  start: string;
  visible: boolean;
  localCandidate: boolean;
};

export type StoryCluster = {
  /** `${kind}:${key}`, stable across runs so that a link to a cluster survives
   * the next recompute. */
  id: string;
  kind: ClusterKind;
  /** The grouping key itself - a node id for `region` and `owner`, a category
   * value like `sport` for `sector`. What a drill-down link is built from. */
  key: string;
  /** The node this cluster is about, where it has one - a region id for
   * `region`, an owner node id for `owner`. Absent for `sector`, whose key is a
   * category rather than anything on the graph. */
  nodeId?: string;
  /** The TERYT code, where the cluster is about a region - which is every
   * `region` cluster and the owner clusters whose owner is a gmina or a
   * województwo. It is what /eksploruj/tabela's `companyTeryt` filter takes,
   * and so the difference between a card that links to the people behind it
   * and one that does not. */
  teryt?: string;
  /** What the card is titled: „Chełm”, „Wodociągi i kanalizacja”, „PKP”. */
  title: string;
  /** The owner, on a cluster that is one brand inside a large owner's holdings.
   * Absent on every other kind. */
  subtitle?: string;
  /** Hires in the window whose company belongs to this cluster, of any
   * publication status. This is the number the statistics are computed on. */
  known: number;
  /** How many of those a logged out reader may open. */
  visible: number;
  /** Distinct companies the hires land at. A cluster confined to one company is
   * a board reshuffle, not a story about a place, so this is a threshold as
   * well as a display field. */
  companies: number;
  /** Hires the group would be expected to have in the window, given its
   * all-time volume and the national rate. See the module note on confounds. */
  expected: number;
  /** How many parties the hires carry, by party. Only the hires with a party at
   * all - two thirds of them carry none, and counting those as a party of their
   * own would drown every purity test. */
  partyMix: Record<string, number>;
  /** The party holding most of the labelled hires, absent where none does. */
  dominantParty?: string;
  /** How many labelled hires the dominant party holds, and out of how many. */
  dominantCount: number;
  labelled: number;
  /** P(at least this many of the labelled hires are the dominant party), under
   * the national mix for the same window. 1 where nothing was testable. */
  partyP: number;
  /** The same, corrected for having tested every group of this kind
   * (Benjamini-Hochberg). This is what a threshold should be applied to. */
  partyQ: number;
  /** The same party test, run again over only the hires nobody has published.
   *
   * `parties[]` covers 92.3% of published people and 13.7% of unpublished ones,
   * and it leans: among labelled hires in the window the published are 36.3%
   * PiS against 20.6% for the unpublished, a 1.8x enrichment. So a town an
   * editor has already worked through looks like a party cluster because it was
   * worked through. Chełm is exactly that - 12 of its 24 hires are published
   * against a national rate of 6.2%, and on the unpublished half alone there is
   * no cluster at all.
   *
   * The detection still runs over everything, because the published half is not
   * a sample. This is the check afterwards: a cluster whose party signal
   * survives on the drafts is one to hand a journalist, and one that does not
   * is a picture of the queue. 1 where the subset was too thin to test. */
  partyPUnpublished: number;
  /** True where the party channel qualified the cluster but does not survive
   * that check. The card may still show the cluster; it may not lead with the
   * party claim. */
  partyIsEditorialArtifact: boolean;
  /** Which channels put this cluster on the list, so a card does not have to
   * re-derive the thresholds to know what it is looking at. */
  channels: ClusterChannel[];
  /** How much more of the cluster is the dominant party than the country is,
   * e.g. 3.0 where 69% of Chełm's labelled hires are PiS against 23% nationally.
   * `partyLiftLow` is the same ratio taken at the pessimistic end of the
   * interval, and is what the list is ordered by. */
  partyLift: number;
  partyLiftLow: number;
  /** P(at least this many hires in the window), under the national share of
   * hires falling in the window. The „something happened here recently” half. */
  burstP: number;
  burstQ: number;
  /** Hires in the window against `expected`, and the same at the pessimistic
   * end of the interval. */
  burstLift: number;
  burstLiftLow: number;
  /** How many of the cluster's companies had two or more people arrive on one
   * day - the register's way of saying a board was replaced rather than a
   * vacancy filled - and the same three statistics against the national rate
   * of that happening (30% of the companies that hired at all). The channel
   * that needs no party labels. */
  swept: number;
  /** How many of them would have been swept at the national rate for companies
   * that hired as often as these did. */
  sweepExpected: number;
  sweepP: number;
  sweepQ: number;
  sweepLift: number;
  sweepLiftLow: number;
  /** Companies swept per month between the first sweep and the last. What
   * separates a rollout from a group that happens to change boards often:
   * Polskie Radio's nine stations come to 1.0 against 0.2-0.5 everywhere else. */
  rolloutPerMonth: number;
  /** Hires by somebody who stood for election in the company's seat region,
   * and how many of them the national rate predicts. A channel in its own
   * right, not only a display field: eight of Chełm's twelve visible hires are
   * local candidates, and „the person who ran on that list here now sits on the
   * town's board” is the most story-shaped fact the graph carries. */
  localCandidates: number;
  localExpected: number;
  localP: number;
  localQ: number;
  localLift: number;
  localLiftLow: number;
  /** People holding seats at two or more of the cluster's companies. */
  crew: ClusterCrewMember[];
  /** Sectors the hires land in, most common first.
   *
   * A list of objects rather than the `[category, count]` pairs it wants to be:
   * Firestore rejects an array whose elements are arrays, and the whole point
   * of this type is that it round-trips through a document. */
  sectors: { category: string; count: number }[];
  /** The hires themselves, newest first, capped by `maxHiresPerCluster`.
   * Visible ones first so a public card never has to page past a draft. */
  hires: ClusterHireRef[];
  /** Earliest and latest hire in the cluster, as `YYYY-MM-DD`. */
  firstStart: string;
  lastStart: string;
  /** What orders the list. See `clusterScore`. */
  score: number;
};

export type ClusterOptions = {
  /** How far back a cluster reaches. Two years by default: one year leaves 92
   * publicly visible hires nationwide, which is too few to bunch, and the
   * April 2024 local elections - the event most of these stories hang off -
   * are inside two. */
  windowDays?: number;
  /** Hires a group needs before it is tested at all. Below four, a binomial
   * tail on the party mix cannot clear any sensible threshold anyway. */
  minKnown?: number;
  /** Distinct companies a group needs. Two, so that one board reshuffle is not
   * a story about a town. */
  minCompanies?: number;
  /** The corrected p-value a group must reach on any of the three tests. */
  maxQ?: number;
  /** How many distinct days, and how many distinct people, a group's labelled
   * hires must span before its party mix is tested. */
  minPartyDates?: number;
  minPartyPeople?: number;
  /** How many hires the dominant party has to hold before the test is worth
   * running at all.
   *
   * Four. A rare party makes two of three look extreme: Nowa Lewica holds
   * about a tenth of the labelled hires in the window, so two of a town's three
   * labelled arrivals comes to a lift of 6.3 and topped the whole list. The
   * Wilson bound discounts small samples but cannot rescue a denominator of
   * three. */
  minPartyCount?: number;
  /** How many local candidates a group needs before that channel is tested.
   * Three, for the reason `minSwept` is three. */
  minLocal?: number;
  /** How many of a group's companies must have had two or more people arrive
   * on one day before its sweep rate is worth testing. Three: two related
   * companies changing board together is a coincidence a big enough register
   * produces daily. */
  minSwept?: number;
  /** How much bigger than the country's the effect has to be before a group is
   * a cluster at all, measured at the pessimistic end of its interval. 1.0 is
   * "provably above the national rate"; the default asks for a fifth more than
   * that, which is what keeps `szpitale` - 1.25x on 3,815 spells, p=1e-14 - off
   * a list it has nothing to say on. */
  minLift?: number;
  /** How many companies an owner may hold before its cluster is subdivided by
   * company-name stem instead. */
  ownerSplitAbove?: number;
  /** How much of the smaller of two clusters may be the same hires before the
   * weaker one is dropped as a second name for the same story. */
  maxOverlap?: number;
  /** How many hires to keep on a cluster. The document holds every cluster the
   * site has, so an uncapped Chełm-sized list on each is what would eventually
   * push it past Firestore's 1 MiB. */
  maxHiresPerCluster?: number;
  /** How many clusters to return at all. The card shows four and the page sixty;
   * past that the list is a tail nobody reads, and the document it is stored in
   * has a hard limit. */
  maxClusters?: number;
};

const DEFAULTS: Required<ClusterOptions> = {
  windowDays: 730,
  minKnown: 4,
  minCompanies: 2,
  maxQ: 0.05,
  minLift: 1.2,
  minPartyDates: 2,
  minPartyPeople: 3,
  minPartyCount: 4,
  minLocal: 3,
  minSwept: 3,
  ownerSplitAbove: 25,
  maxOverlap: 0.7,
  maxHiresPerCluster: 25,
  maxClusters: 60,
};

/** `ln(n!)`, from a table built as far as it has been asked for.
 *
 * A binomial tail here runs over a group's all-time hire count against the
 * national one, and those denominators reach five figures - where
 * `n! / (k!(n-k)!)` computed directly is `Infinity / Infinity` long before the
 * answer stops being representable. So the whole tail is summed in log space
 * and exponentiated one term at a time.
 *
 * A table of running sums rather than a Lanczos approximation: the argument is
 * always a whole number, the table is built once and reused across every
 * cluster in a run, and it is exact rather than exact-to-fifteen-digits.
 */
const logFactorials = [0, 0];
function logFactorial(n: number): number {
  for (let i = logFactorials.length; i <= n; i++) {
    logFactorials.push(logFactorials[i - 1]! + Math.log(i));
  }
  return logFactorials[n]!;
}

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** `P(X >= k)` for `X ~ Binomial(n, p)`.
 *
 * The one statistic this module rests on, in both of its tests: "this town's
 * hires are PiS more often than the country's are" and "this town had more
 * hires in the window than its own volume predicts" are the same question asked
 * of different counts.
 *
 * Summed from `k` upwards rather than as `1 - P(X < k)`: the interesting tails
 * are around 1e-06, which the complement loses to floating point entirely.
 */
export function binomialTail(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (n <= 0 || k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let total = 0;
  for (let i = k; i <= n; i++) {
    total += Math.exp(
      logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log1p(-p),
    );
  }
  return Math.min(1, total);
}

/** `P(X >= k)` where each trial has its own probability - a Poisson binomial.
 *
 * The sweep test needs it because a company's chance of having two people
 * arrive on one day is almost entirely a function of how many people arrived at
 * all. Measured over the window: a company with one hire is swept 0% of the
 * time (it cannot be), with two 37.8%, three 60.3%, four 77.6%, five or six
 * 92.3%, seven or more 100%. Testing a group against one flat rate therefore
 * rewards nothing but volume, which is the confound every other statistic here
 * exists to remove. Each company is compared against the rate for companies
 * that hired as often as it did, and the tail is the convolution of those.
 *
 * O(n^2) by dynamic programming over the distribution, which for the largest
 * group in the graph - 269 hospitals - is 72,000 multiplications once a day.
 */
export function poissonBinomialTail(
  k: number,
  probabilities: number[],
): number {
  if (k <= 0) return 1;
  if (k > probabilities.length) return 0;
  let distribution = [1];
  for (const p of probabilities) {
    const next = new Array<number>(distribution.length + 1).fill(0);
    for (let i = 0; i < distribution.length; i++) {
      next[i]! += distribution[i]! * (1 - p);
      next[i + 1]! += distribution[i]! * p;
    }
    distribution = next;
  }
  let tail = 0;
  for (let i = k; i < distribution.length; i++) tail += distribution[i]!;
  return Math.min(1, Math.max(0, tail));
}

/** `P(span <= observed)` for `k` points dropped uniformly into a window.
 *
 * The other half of a rollout. „Six of nine stations had their boards replaced”
 * is one claim and „all six inside nine months of a two-year window” is a
 * second, independent one, and it is the second that separates Polskie Radio
 * (six sweeps in 263 days, p=0.026) from a holding that changes a board
 * whenever one falls due. Without it the rollout channel has one test with
 * eight or nine members and no power to speak of: the strongest rollout in the
 * graph comes to p=0.012, which a correction over eight tests turns into 0.09.
 *
 * The distribution of the range of k uniform points is `k*r^(k-1) -
 * (k-1)*r^k`, where r is the observed span as a fraction of the window.
 */
export function spanTail(
  k: number,
  spanDays: number,
  windowDays: number,
): number {
  if (k < 2 || windowDays <= 0) return 1;
  const r = Math.min(1, Math.max(0, spanDays / windowDays));
  return Math.min(1, k * Math.pow(r, k - 1) - (k - 1) * Math.pow(r, k));
}

/** Fisher's method for two independent tests, which for four degrees of
 * freedom has the closed form `e^(-x/2) * (1 + x/2)`.
 *
 * The rollout channel asks two questions of the same group - how many of its
 * companies were swept, and how close together - and neither on its own is
 * strong enough to survive a correction. Combined they are: 0.012 and 0.026
 * come to 0.0027.
 */
export function fisherCombine(first: number, second: number): number {
  if (first >= 1 && second >= 1) return 1;
  const x =
    -2 *
    (Math.log(Math.max(first, 1e-300)) + Math.log(Math.max(second, 1e-300)));
  return Math.min(1, Math.exp(-x / 2) * (1 + x / 2));
}

/** How many hires a company had in the window, bucketed the way the sweep rate
 * actually varies with it. Kept as a function so the buckets are named once. */
export function sweepBucket(hiresInWindow: number): number {
  if (hiresInWindow <= 4) return hiresInWindow;
  if (hiresInWindow <= 6) return 5;
  if (hiresInWindow <= 10) return 7;
  return 11;
}

/** The lower end of a Wilson score interval on `k/n`, one sided at ~2.5%.
 *
 * This is what ORDERS the list, and a p-value is not, because a p-value ranks
 * by sample size rather than by effect. Measured, on the graph as it stands:
 * `szpitale` has 1,040 of its 3,815 spells inside the window against 832
 * expected - a lift of 1.25, thoroughly unremarkable - and the binomial tail on
 * it is 1e-14, which put it at the top of every list ahead of Chełm's threefold
 * one. Over 3,815 trials a 25% excess is beyond doubt; it is just not a story.
 *
 * A Wilson bound says the other thing: how big is the effect, given how much
 * evidence there is for it. Four hires that are all one party earns less than
 * sixteen that are two thirds, which is the ordering a reader wants.
 */
export function wilsonLowerBound(k: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const phat = k / n;
  const z2 = z * z;
  const centre = phat + z2 / (2 * n);
  const spread = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - spread) / (1 + z2 / n));
}

/** Benjamini-Hochberg over the entries where the test actually ran.
 *
 * A group with no party on any of its hires is not a party test that came out
 * negative; it is a party test nobody performed, and its p of 1 does not belong
 * in the family. Left in, it counts towards the correction's denominator, and
 * since most groups are in that position it inflates every q by three or four
 * times - which is what kept Polskie Radio's rollout (p=0.024) off the list.
 * Entries that were not tested keep a q of 1.
 */
function correctTested(pValues: number[]): number[] {
  const tested = pValues
    .map((p, i) => ({ p, i }))
    .filter((entry) => entry.p < 1);
  const q = new Array<number>(pValues.length).fill(1);
  const corrected = benjaminiHochberg(tested.map((entry) => entry.p));
  tested.forEach((entry, rank) => {
    q[entry.i] = corrected[rank]!;
  });
  return q;
}

/** Benjamini-Hochberg, in place of a Bonferroni that would throw away every
 * true positive here.
 *
 * Around two hundred regions are tested at once, so a raw p of 0.01 is what a
 * couple of regions will show by chance alone. Dividing the threshold by two
 * hundred instead would leave only Rzeszów and Chełm, and the point of the list
 * is the next twenty. BH controls the share of the list that is noise rather
 * than the chance of any noise at all, which is the right trade for something a
 * person is going to read down.
 *
 * Returns q-values positionally aligned with the input.
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const n = pValues.length;
  if (n === 0) return [];
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(n);
  let previous = 1;
  for (let rank = n; rank >= 1; rank--) {
    const entry = order[rank - 1]!;
    previous = Math.min(previous, (entry.p * n) / rank);
    q[entry.i] = Math.min(1, previous);
  }
  return q;
}

/** What orders the list a reader sees.
 *
 * The two effects, each already discounted for how little evidence there is
 * behind it (see `wilsonLowerBound`), and then lifted by the two features that
 * make a cluster legible rather than merely significant: a crew - the same
 * people turning up across several of the companies - and hires by people who
 * stood for election in the same town.
 *
 * The party lift is weighted double. It is a statement about *composition*, so
 * it survives the graph knowing only a third of a town's board changes; the
 * burst lift is a statement about *volume*, which is exactly what an uneven
 * crawl distorts. Where the two disagree, the composition is the one to trust.
 */
export function clusterScore(cluster: {
  partyLiftLow: number;
  burstLiftLow: number;
  sweepLiftLow: number;
  localLiftLow: number;
  rolloutPerMonth: number;
  known: number;
  crew: unknown[];
  localCandidates: number;
}): number {
  const party = Math.max(0, cluster.partyLiftLow - 1);
  const burst = Math.max(0, cluster.burstLiftLow - 1);
  /* Scaled by how fast the rollout ran, because that is what the sweep channel
   * is actually reporting. Six of nine stations swept is unremarkable spread
   * over two years and is the story when it happens in nine months. */
  const sweep =
    Math.max(0, cluster.sweepLiftLow - 1) *
    (1 + Math.min(cluster.rolloutPerMonth, 2));
  const localCandidacy = Math.max(0, cluster.localLiftLow - 1);
  const crew = 1 + 0.25 * Math.min(cluster.crew.length, 4);
  /* Still a multiplier as well as a channel. A cluster carried by its party mix
   * reads very differently when the people in it also stood for election there,
   * and that is worth ranking up even where the rate itself is unremarkable. */
  const local =
    1 + 0.5 * (cluster.localCandidates / Math.max(cluster.known, 1));
  return (2 * party + burst + sweep + localCandidacy) * crew * local;
}

function isoDaysBefore(iso: string, days: number): string {
  const at = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return new Date(at - days * 86400000).toISOString().slice(0, 10);
}

/** Whole months between two `YYYY-MM-DD` days, by calendar rather than by
 * dividing days: a rollout that runs from the end of September to the start of
 * the following June is nine months, and 253/30 is eight. */
function daysBetween(from: string, to: string): number {
  return Math.max(
    0,
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86400000,
  );
}

function monthsBetween(from: string, to: string): number {
  const months = (iso: string) =>
    Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
  return months(to) - months(from);
}

/** Whether a group's companies are a numbered fleet rather than a story.
 *
 * „INVEST PV 7”, „INVEST PV 40”, „INVEST PV 58”, „INVEST PV 59”; „ORLEN NEPTUN
 * III” through „X”; „ESV2” to „ESV9”. A holding registers a special-purpose
 * vehicle per project and staffs all of them from the same two or three people,
 * which every statistic here reads as a coordinated sweep by a tight crew - it
 * was 11 of the 25 crews the first version of this found, and the top two.
 *
 * The tell is that the names differ only by a number. Polskie Radio's stations
 * share a stem too and are not caught: they differ by the town they broadcast
 * from, which is a word.
 */
function isNumberedFleet(rows: ClusterHire[]): boolean {
  const names = Array.from(new Set(rows.map((hire) => hire.companyName)));
  if (names.length < 3) return false;
  const stripped = new Set(
    names.map((name) =>
      name
        .toUpperCase()
        .replace(/\b[IVXLC]+\b/g, " ")
        .replace(/[0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ),
  );
  return stripped.size === 1;
}

function nameCluster(
  key: string,
  labels: ClusterLabels,
): { title: string; subtitle?: string } {
  const split = key.indexOf(OWNER_STEM_SEPARATOR);
  if (split < 0) return { title: labels.titles[key] ?? key };
  const owner = key.slice(0, split);
  const stem = key.slice(split + OWNER_STEM_SEPARATOR.length);
  return {
    title: stem,
    subtitle: labels.titles[owner] ?? owner,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A name folded to ASCII and lowercased, for comparing two of them. */
function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .trim();
}

function nameTokens(value: string): string[] {
  return foldName(value).split(/\s+/).filter(Boolean);
}

/** Whether one name is the other with middle names left out - „Robert Gut” and
 * „Robert Paweł Gut”. Both directions, and never for a different surname. */
function isFullerName(shorter: string[], longer: string[]): boolean {
  if (shorter.length === 0 || longer.length < shorter.length) return false;
  if (shorter[0] !== longer[0]) return false;
  if (shorter[shorter.length - 1] !== longer[longer.length - 1]) return false;
  return shorter.every((token) => longer.includes(token));
}

/** One id per human, and one per company, for pages that are the same thing
 * twice.
 *
 * Cluster size is the claim a cluster makes, so counting one person twice
 * fabricates it. Measured on the graph: 150 first-and-last-name keys resolve to
 * more than one person node, covering 902 of 18,658 employment rows - and one
 * of them was on the public list. „Gmina Skierniewice”, six visible hires
 * across five companies, is „Robert Gut” and „Robert Paweł Gut”: one man.
 *
 * The rule is deliberately narrow. Same first token, same last token, and one
 * full name a subset of the other; a birth date on both sides that disagrees
 * refuses the merge outright. Namesakes with the same middle name survive it,
 * which is the right way to be wrong: the site has a `needs_split` flag for
 * pages that are two humans and no automatic way to tell them apart.
 *
 * Companies fold on the identifier where there is one - two nodes carrying the
 * same KRS number are the same company - or on the whole name being identical.
 * Not on a shared base name: „MWiK” in Kołobrzeg and „MWiK” in Ostrowiec are
 * different companies, and folding on that made 374 wrong merges.
 */
export function foldIdentities(hires: ClusterHire[]): {
  person: Map<string, string>;
  company: Map<string, string>;
} {
  const person = new Map<string, string>();
  const byNameKey = new Map<
    string,
    { id: string; tokens: string[]; birth?: string }[]
  >();
  for (const hire of hires) {
    if (person.has(hire.personId)) continue;
    const tokens = nameTokens(hire.personName);
    if (tokens.length < 2) {
      person.set(hire.personId, hire.personId);
      continue;
    }
    const key = `${tokens[0]}|${tokens[tokens.length - 1]}`;
    const candidates = byNameKey.get(key) ?? [];
    const match = candidates.find(
      (other) =>
        (isFullerName(other.tokens, tokens) ||
          isFullerName(tokens, other.tokens)) &&
        !(other.birth && hire.birthDate && other.birth !== hire.birthDate),
    );
    if (match) {
      person.set(hire.personId, person.get(match.id) ?? match.id);
      continue;
    }
    candidates.push({ id: hire.personId, tokens, birth: hire.birthDate });
    byNameKey.set(key, candidates);
    person.set(hire.personId, hire.personId);
  }

  const company = new Map<string, string>();
  const byKrs = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const hire of hires) {
    if (company.has(hire.companyId)) continue;
    const krs = hire.companyKrs;
    const name = foldName(hire.companyName);
    const existing =
      (krs ? byKrs.get(krs) : undefined) ??
      (name ? byName.get(name) : undefined);
    if (existing) {
      company.set(hire.companyId, existing);
      continue;
    }
    if (krs) byKrs.set(krs, hire.companyId);
    if (name) byName.set(name, hire.companyId);
    company.set(hire.companyId, hire.companyId);
  }

  return { person, company };
}

/** The parties on a hire, as the site counts them.
 *
 * Two corrections, both of which the graph needs and neither of which is this
 * module's invention. `canonicalParty` merges the names the site already treats
 * as one - SLD into Nowa Lewica - and must be applied to a set, or a person
 * filed under both is counted twice for the same seat. And a hire contributes
 * at most one to any party, which is what makes the dominant share a
 * proportion of hires rather than of (hire, party) pairs: 72 of the 73 hires
 * tagged „Polska 2050” in the window are Trzecia Droga joint-list candidates
 * carrying PSL as well, and counting the pairs made a group of fourteen people
 * look like sixteen labelled seats.
 */
function partiesOf(hire: { parties: string[] }): string[] {
  return Array.from(new Set(hire.parties.filter(Boolean).map(clusterParty)));
}

/** Coalition partners that share a list, collapsed into one label.
 *
 * Kept here rather than added to `partyAliases` in `shared/misc.ts`, which also
 * drives `PartyChip`, `partyAliasesOf` and the table's party filter: Polska
 * 2050 is a real party and the site is right to name it. What is not real is
 * the *labelling*: `parties_of_committee` maps „KKW Trzecia Droga PSL-PL2050”
 * to both, and unions both onto the person - so 72 of the 73 hires the graph
 * tags Polska 2050 in the window are PSL candidates on a joint list, and 46% of
 * the PSL-tagged hires are the same rows again. Two clusters that cleared
 * p<1e-3 were that and nothing else, Tarnów and Sosnowiec. Collapsing the pair
 * takes the false-positive rate over 200 label permutations from 6% to 1%.
 */
const CLUSTER_PARTY_ALIASES: Record<string, string> = {
  "Polska 2050": "PSL",
};

function clusterParty(party: string): string {
  const canonical = canonicalParty(party);
  return CLUSTER_PARTY_ALIASES[canonical] ?? canonical;
}

/** How many hires carry each party. */
function partyCounts(hires: { parties: string[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const hire of hires) {
    for (const party of partiesOf(hire)) {
      counts[party] = (counts[party] ?? 0) + 1;
    }
  }
  return counts;
}

function countBy<T>(items: T[], key: (item: T) => string | undefined) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/** Every group key a hire belongs to, for one kind.
 *
 * A hire belongs to exactly one region and to any number of sectors and owners,
 * which is why this returns a list. A company filed under both `szpitale` and
 * `przychodnie` genuinely belongs to both stories.
 */
function keysFor(
  hire: ClusterHire,
  kind: ClusterKind,
  bigOwners: Set<string>,
): string[] {
  if (kind === "region") return hire.regionId ? [hire.regionId] : [];
  if (kind === "sector") return hire.categories;
  return (hire.ownerIds ?? []).map((owner) =>
    bigOwners.has(owner)
      ? `${owner}${OWNER_STEM_SEPARATOR}${companyNameStem(hire.companyName)}`
      : owner,
  );
}

/** Separates an owner from the name stem it was subdivided by. A vertical bar,
 * because a Firestore document id may contain anything but a slash and a
 * company name may contain anything at all. */
export const OWNER_STEM_SEPARATOR = "|";

/** The first two words of a company's name, folded for comparison.
 *
 * The proxy for a corporate group the ownership graph does not carry. „POLSKIE
 * RADIO - REGIONALNA ROZGŁOŚNIA W KATOWICACH” and its sixteen siblings share an
 * owner (Skarb Państwa, which owns 112 other companies too) and nothing else -
 * the parent, POLSKIE RADIO SA, is on the graph but has no `owns` edge to a
 * single station, and the stations are seated in sixteen different regions. Two
 * words is what recovers them.
 *
 * On its own the stem is useless: the biggest families it makes are „MIEJSKIE
 * PRZEDSIĘBIORSTWO” (117 companies), „SAMODZIELNY PUBLICZNY” (94) and „ZAKŁAD
 * GOSPODARKI” (89) - legal boilerplate shared by unrelated companies in
 * unrelated towns. It is only used to subdivide an owner that holds too many
 * companies to be a story by itself, where the owner supplies the relatedness
 * and the stem supplies the brand.
 */
export function companyNameStem(name: string): string {
  const folded = name
    .replace(/\(.*?\)/g, " ")
    .replace(/["\u201e\u201d]/g, "")
    .toUpperCase()
    .replace(
      /[^A-Z0-9\u0104\u0106\u0118\u0141\u0143\u00d3\u015a\u0179\u017b ]+/g,
      " ",
    );
  return folded.split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
}

/** Where „Zobacz w tabeli” on a cluster card goes, or an empty string where
 * there is nothing to link to.
 *
 * `companyTeryt`, not `teryt`. The two are different dimensions and are easy to
 * swap: `companyTeryt` resolves regions and intersects them with the employer
 * set, which is what a cluster keyed on where the companies are registered
 * means, while `teryt` filters on the person's own region edges. And
 * `currentlyEmployed=selected`, because without it the table answers who has
 * ever held one of these seats rather than who holds one now.
 *
 * An owner cluster gets nothing: /eksploruj/tabela has no owner filter, so the
 * card links to the owner's own page instead.
 */
export function clusterTableLink(cluster: {
  kind: ClusterKind;
  key: string;
  teryt?: string;
}): string {
  const sort =
    "currentlyEmployed=selected&sortBy=latestEmploymentStart&sortDesc=true";
  if (cluster.kind === "sector") {
    return `/eksploruj/tabela?category=${encodeURIComponent(cluster.key)}&${sort}`;
  }
  if (cluster.teryt) {
    return `/eksploruj/tabela?companyTeryt=${cluster.teryt}&${sort}`;
  }
  return "";
}

/** What a key is called, and where it points.
 *
 * Region and owner keys are node ids and need the node's name; a sector key is
 * its own label and the caller passes `categoryTitle`. Anything unnamed keeps
 * its key, which is visible enough to be reported as a bug.
 */
export type ClusterLabels = {
  titles: Record<string, string>;
  /** TERYT codes, for those keys that name a region node. */
  teryts?: Record<string, string>;
};

export function computeStoryClusters(
  hires: ClusterHire[],
  now: string,
  labels: ClusterLabels,
  options: ClusterOptions = {},
): StoryCluster[] {
  const opts = { ...DEFAULTS, ...options };
  const windowStart = isoDaysBefore(now, opts.windowDays);

  /* One appointment is one row, however many times the register wrote it down.
   * 208 rows repeat a (person, company, role, day) exactly and another 60
   * repeat the day with the role spelled differently - „Zarząd” on one and
   * „Prezes Zarządu” on the other - and every one of them inflates the count a
   * binomial tail is computed from. Keyed without the role for that reason:
   * two seats taken at one company on one day are one appointment. */
  const identities = foldIdentities(hires);
  const seen = new Set<string>();
  const deduped: ClusterHire[] = [];
  for (const hire of hires) {
    const personId = identities.person.get(hire.personId) ?? hire.personId;
    const companyId = identities.company.get(hire.companyId) ?? hire.companyId;
    const key = `${personId}@${companyId}@${hire.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    /* Rewritten onto the surviving ids so that every count downstream - the
     * crew, the companies, the acts - is a count of humans and companies
     * rather than of pages. */
    deduped.push({ ...hire, personId, companyId });
  }

  const dated = deduped.filter((h) => h.start && h.start <= now);
  const recent = dated.filter((h) => h.start >= windowStart);
  if (recent.length === 0) return [];

  /* Owners holding more companies than any one story could be about. Skarb
   * Państwa owns 112 of them and hires into 62 in a two-year window; a cluster
   * headed „Skarb Państwa” says only that the state employs people. Those get
   * subdivided by company-name stem, which is what turns the bucket into
   * „Skarb Państwa / POLSKIE RADIO”. See `companyNameStem`. */
  const companiesByOwner = new Map<string, Set<string>>();
  for (const hire of dated) {
    for (const owner of hire.ownerIds ?? []) {
      const seenCompanies = companiesByOwner.get(owner) ?? new Set<string>();
      seenCompanies.add(hire.companyId);
      companiesByOwner.set(owner, seenCompanies);
    }
  }
  const bigOwners = new Set(
    Array.from(companiesByOwner)
      .filter(([, companies]) => companies.size > opts.ownerSplitAbove)
      .map(([owner]) => owner),
  );

  /* An appointment act: everybody who took a seat at one company on one day.
   * A company where two or more arrived together has had its board changed
   * rather than a vacancy filled, and it is the unit the sweep channel counts.
   * 4,039 hires in the window collapse to 2,787 acts, 596 of them multi-person,
   * covering 543 of the 1,804 companies that hired at all - the 30% base rate
   * a group's own sweep rate is compared against. */
  const actPeople = new Map<string, Set<string>>();
  for (const hire of recent) {
    const key = `${hire.companyId}@${hire.start}`;
    const people = actPeople.get(key) ?? new Set<string>();
    people.add(hire.personId);
    actPeople.set(key, people);
  }
  const sweptCompanies = new Set<string>();
  for (const [key, people] of actPeople) {
    if (people.size >= 2)
      sweptCompanies.add(key.slice(0, key.lastIndexOf("@")));
  }

  /* How often a company of each size was swept, nationally. This is the null
   * the sweep test is run against; see `poissonBinomialTail` for why it cannot
   * be one number. */
  const hiresPerCompany = new Map<string, number>();
  for (const hire of recent) {
    hiresPerCompany.set(
      hire.companyId,
      (hiresPerCompany.get(hire.companyId) ?? 0) + 1,
    );
  }
  const bucketTotals = new Map<number, { companies: number; swept: number }>();
  for (const [companyId, count] of hiresPerCompany) {
    const bucket = sweepBucket(count);
    const totals = bucketTotals.get(bucket) ?? { companies: 0, swept: 0 };
    totals.companies += 1;
    if (sweptCompanies.has(companyId)) totals.swept += 1;
    bucketTotals.set(bucket, totals);
  }
  /* Per-company history, for the burst channel's denominator: how many spells
   * the graph holds for each company, and the earliest one it can date. */
  const allByCompany = new Map<string, number>();
  const earliestStart = new Map<string, string>();
  for (const hire of dated) {
    allByCompany.set(
      hire.companyId,
      (allByCompany.get(hire.companyId) ?? 0) + 1,
    );
    const earliest = earliestStart.get(hire.companyId);
    if (earliest === undefined || hire.start < earliest) {
      earliestStart.set(hire.companyId, hire.start);
    }
  }

  /* The two local-candidacy base rates: how often a hire at a municipally
   * owned company, and at any other, went to somebody who had stood for
   * election in that company's own region. */
  const localStrata = new Map<OwnerTier, { hires: number; local: number }>();
  for (const hire of recent) {
    const tier = hire.ownerTier ?? "brak";
    const totals = localStrata.get(tier) ?? { hires: 0, local: 0 };
    totals.hires += 1;
    if (hire.localCandidate) totals.local += 1;
    localStrata.set(tier, totals);
  }
  const localRate = (tier: OwnerTier | undefined): number => {
    const totals = localStrata.get(tier ?? "brak");
    if (!totals || totals.hires === 0) return 0;
    return totals.local / totals.hires;
  };

  const sweepRate = (hiresInWindow: number): number => {
    const totals = bucketTotals.get(sweepBucket(hiresInWindow));
    if (!totals || totals.companies === 0) return 0;
    return totals.swept / totals.companies;
  };

  /* The national rate a group's volume is compared against: of every spell the
   * graph can date, what share began inside the window. Computed over all
   * hires rather than per year, because that is exactly the trend that has to
   * be common to both sides of the comparison for it to cancel. */
  const nationalWindowShare = recent.length / dated.length;

  /* The national party mix, over labelled hires in the same window. Two thirds
   * of hires carry no party; including them as a category of their own would
   * make every group's dominant share look tiny and identical.
   *
   * A group is counted in the baseline it is measured against, rather than the
   * baseline being recomputed without it. That shrinks every lift slightly and
   * shrinks a large group's most - which is the safe direction, and on this
   * graph it is not a real quantity anyway: the largest cluster is 225 hires
   * against 4,039 in the window. */
  const nationalPartyCounts = partyCounts(recent);
  const nationalLabelled = recent.filter(
    (hire) => partiesOf(hire).length > 0,
  ).length;

  /* The same mix, worked out separately for each kind of owner. What a group's
   * party share is actually tested against - see `ClusterHire.ownerTier`. */
  const labelledByTier = new Map<OwnerTier, number>();
  const partyByTier = new Map<OwnerTier, Record<string, number>>();
  for (const hire of recent) {
    const parties = partiesOf(hire);
    if (parties.length === 0) continue;
    const tier = hire.ownerTier ?? "brak";
    labelledByTier.set(tier, (labelledByTier.get(tier) ?? 0) + 1);
    const counts = partyByTier.get(tier) ?? {};
    for (const party of parties) counts[party] = (counts[party] ?? 0) + 1;
    partyByTier.set(tier, counts);
  }
  /** The share of labelled hires in this hire's own stratum that carry `party`,
   * falling back to the national share where the stratum is too thin to say. */
  const partyRate = (tier: OwnerTier | undefined, party: string): number => {
    const labelled = labelledByTier.get(tier ?? "brak") ?? 0;
    if (labelled >= 20) {
      return (partyByTier.get(tier ?? "brak")?.[party] ?? 0) / labelled;
    }
    return nationalLabelled > 0
      ? (nationalPartyCounts[party] ?? 0) / nationalLabelled
      : 0;
  };

  const kinds: ClusterKind[] = ["region", "sector", "owner"];
  const clusters: StoryCluster[] = [];
  /* The hires behind each cluster, positionally aligned with `clusters`, so
   * that near-duplicates can be found before the lists are trimmed for
   * storage. See `dropNearDuplicates`. */
  const backing: Set<string>[] = [];

  for (const kind of kinds) {
    /* Every hire ever, grouped the same way as the recent ones: the denominator
     * of the burst test is the group's all-time volume, not its window. */
    const allByKey = new Map<string, number>();
    for (const hire of dated) {
      for (const key of keysFor(hire, kind, bigOwners)) {
        allByKey.set(key, (allByKey.get(key) ?? 0) + 1);
      }
    }

    const recentByKey = new Map<string, ClusterHire[]>();
    for (const hire of recent) {
      for (const key of keysFor(hire, kind, bigOwners)) {
        const bucket = recentByKey.get(key);
        if (bucket) bucket.push(hire);
        else recentByKey.set(key, [hire]);
      }
    }

    type Tested = {
      key: string;
      rows: ClusterHire[];
      partyP: number;
      partyLift: number;
      partyLiftLow: number;
      burstP: number;
      burstLift: number;
      burstLiftLow: number;
      sweepP: number;
      sweepLift: number;
      sweepLiftLow: number;
      sweepExpected: number;
      swept: number;
      partyPUnpublished: number;
      localP: number;
      localLift: number;
      localLiftLow: number;
      localExpected: number;
      expected: number;
    };
    const tested: Tested[] = [];

    for (const [key, rows] of recentByKey) {
      const companies = new Set(rows.map((h) => h.companyId)).size;
      if (rows.length < opts.minKnown || companies < opts.minCompanies)
        continue;

      const counts = partyCounts(rows);
      let partyP = 1;
      let partyLift = 0;
      let partyLiftLow = 0;
      let dominantCount = 0;
      let dominantParty: string | undefined;
      for (const [party, count] of Object.entries(counts)) {
        if (count <= dominantCount) continue;
        dominantCount = count;
        dominantParty = party;
      }
      /* One appointment is not a sample of the town. Nine of podkarpackie's
       * 25 PiS seats start on one day at one hospital, and the largest single
       * act in the graph is seventeen people at Koszalin on 2026-05-29 - a
       * binomial treats each as an independent draw and reports a certainty
       * that comes from one decision by one person. The sweep channel wants
       * exactly the opposite and is gated separately. */
      const labelledRows = rows.filter((hire) => partiesOf(hire).length > 0);
      const partyDates = new Set(labelledRows.map((hire) => hire.start)).size;
      const partyPeople = new Set(labelledRows.map((hire) => hire.personId))
        .size;
      const partyTestable =
        partyDates >= opts.minPartyDates &&
        partyPeople >= opts.minPartyPeople &&
        dominantCount >= opts.minPartyCount;
      if (dominantParty && partyTestable) {
        /* One probability per labelled hire, taken from the stratum that hire
         * belongs to, and the tail is the convolution of them. Where every hire
         * is in the same stratum this is exactly the binomial it replaces. */
        const party = dominantParty;
        const probabilities = labelledRows.map((hire) =>
          partyRate(hire.ownerTier, party),
        );
        const expectedParty = probabilities.reduce((a, b) => a + b, 0);
        if (expectedParty > 0) {
          partyP = poissonBinomialTail(dominantCount, probabilities);
          partyLift = dominantCount / expectedParty;
          const variance = probabilities.reduce((a, p) => a + p * (1 - p), 0);
          partyLiftLow =
            Math.max(0, dominantCount - 1.96 * Math.sqrt(variance)) /
            expectedParty;
        }
      }

      /* The burst test is skipped for a sector: its own hires are most of the
       * stratum it would be compared against, so it is asking whether a thing
       * differs from itself. Composition is the only question that means
       * anything at this level. */
      const groupCompanies = new Set(rows.map((h) => h.companyId));

      /* The burst channel's denominator is the group's own recorded history,
       * and the record is itself a crawl artefact: a company first entered into
       * the graph last year has every one of its spells inside the window, so
       * `allTime * nationalWindowShare` predicts a fifth of what it has and the
       * lift comes out at 4.5 for nothing at all. Swept companies carry 22.1
       * stored spells on average against 6.8 for the rest, so this is not a
       * rare shape.
       *
       * Two guards. Companies whose earliest known spell is inside the window
       * contribute nothing to the denominator, and a group needs at least two
       * companies the graph knew about before the window opened. */
      const establishedCompanies = new Set(
        Array.from(groupCompanies).filter((companyId) => {
          const earliest = earliestStart.get(companyId);
          return earliest !== undefined && earliest < windowStart;
        }),
      );
      const allTime = Array.from(establishedCompanies).reduce(
        (total, companyId) => total + (allByCompany.get(companyId) ?? 0),
        0,
      );
      const expected = allTime * nationalWindowShare;
      let burstP = 1;
      let burstLift = 0;
      let burstLiftLow = 0;
      if (kind !== "sector" && establishedCompanies.size >= 2 && allTime > 0) {
        /* Counted over the established companies on both sides, so the
         * numerator and the denominator describe the same set. */
        const recentHere = rows.filter((hire) =>
          establishedCompanies.has(hire.companyId),
        ).length;
        burstP = binomialTail(recentHere, allTime, nationalWindowShare);
        burstLift = recentHere / allTime / nationalWindowShare;
        burstLiftLow =
          wilsonLowerBound(recentHere, allTime) / nationalWindowShare;
      }

      /* The party-free channel. Only 2 of the 18 people appointed to Polskie
       * Radio's regional boards since 2025 carry a party at all, and 12.4% of
       * hires at uncategorised companies do - a detector that can only see a
       * party mix is blind to most of the register. What it can always see is
       * whether the boards of several related companies were replaced at once. */
      let swept = 0;
      for (const companyId of groupCompanies) {
        if (sweptCompanies.has(companyId)) swept += 1;
      }
      let sweepP = 1;
      let sweepLift = 0;
      let sweepLiftLow = 0;
      let sweepExpected = 0;
      if (swept >= opts.minSwept) {
        const probabilities = Array.from(groupCompanies, (companyId) =>
          sweepRate(hiresPerCompany.get(companyId) ?? 0),
        );
        sweepExpected = probabilities.reduce((a, b) => a + b, 0);
        const variance = probabilities.reduce((a, p) => a + p * (1 - p), 0);
        if (sweepExpected > 0) {
          const sweepDays = rows
            .filter((hire) => sweptCompanies.has(hire.companyId))
            .map((hire) => hire.start)
            .sort();
          const span = daysBetween(
            sweepDays[0]!,
            sweepDays[sweepDays.length - 1]!,
          );
          sweepP = fisherCombine(
            poissonBinomialTail(swept, probabilities),
            spanTail(swept, span, opts.windowDays),
          );
          sweepLift = swept / sweepExpected;
          /* A normal lower bound rather than a Wilson one: the trials do not
           * share a probability, so there is no single proportion to bound.
           * Same intent - the effect at the pessimistic end of its interval. */
          sweepLiftLow =
            Math.max(0, swept - 1.96 * Math.sqrt(variance)) / sweepExpected;
        }
      }

      /* Local candidacy, tested within the stratum the company belongs to. The
       * rate at which a municipally owned company hires somebody who stood for
       * election in its own town is nothing like the rate at which a
       * state-owned one does, and one national number would rank every gmina
       * above every ministry for being a gmina. */
      let localExpected = 0;
      for (const hire of rows) {
        localExpected += localRate(hire.ownerTier);
      }
      const localCandidates = rows.filter((hire) => hire.localCandidate).length;
      let localP = 1;
      let localLift = 0;
      let localLiftLow = 0;
      if (localExpected > 0 && localCandidates >= opts.minLocal) {
        localP = poissonBinomialTail(
          localCandidates,
          rows.map((hire) => localRate(hire.ownerTier)),
        );
        localLift = localCandidates / localExpected;
        const variance = rows.reduce((total, hire) => {
          const p = localRate(hire.ownerTier);
          return total + p * (1 - p);
        }, 0);
        localLiftLow =
          Math.max(0, localCandidates - 1.96 * Math.sqrt(variance)) /
          localExpected;
      }

      /* The same test again, over the hires nobody has published. Same strata,
       * same national rates - only the rows change - so a cluster that keeps
       * its effect here is not a picture of the editorial queue. */
      let partyPUnpublished = 1;
      if (dominantParty) {
        const drafts = labelledRows.filter((hire) => !hire.visible);
        const draftDominant = drafts.filter((hire) =>
          partiesOf(hire).includes(dominantParty),
        ).length;
        const draftDates = new Set(drafts.map((hire) => hire.start)).size;
        const draftPeople = new Set(drafts.map((hire) => hire.personId)).size;
        if (
          draftDominant >= 2 &&
          draftDates >= opts.minPartyDates &&
          draftPeople >= opts.minPartyPeople
        ) {
          const party = dominantParty;
          partyPUnpublished = poissonBinomialTail(
            draftDominant,
            drafts.map((hire) => partyRate(hire.ownerTier, party)),
          );
        }
      }

      tested.push({
        key,
        rows,
        partyPUnpublished,
        localP,
        localLift,
        localLiftLow,
        localExpected,
        swept,
        sweepP,
        sweepLift,
        sweepLiftLow,
        sweepExpected,
        partyP,
        partyLift,
        partyLiftLow,
        burstP,
        burstLift,
        burstLiftLow,
        expected,
      });
    }

    const partyQ = correctTested(tested.map((t) => t.partyP));
    const burstQ = correctTested(tested.map((t) => t.burstP));
    const sweepQ = correctTested(tested.map((t) => t.sweepP));
    const localQ = correctTested(tested.map((t) => t.localP));

    tested.forEach((entry, index) => {
      const q = {
        party: partyQ[index]!,
        burst: burstQ[index]!,
        sweep: sweepQ[index]!,
        local: localQ[index]!,
      };
      /* Both halves of each test have to hold: the correction says the effect
       * is unlikely to be noise, the lift says it is large enough to be worth
       * reading. Either test may be the one that carries the cluster. */
      const byParty =
        q.party <= opts.maxQ && entry.partyLiftLow >= opts.minLift;
      const byBurst =
        q.burst <= opts.maxQ && entry.burstLiftLow >= opts.minLift;
      const bySweep =
        q.sweep <= opts.maxQ && entry.sweepLiftLow >= opts.minLift;
      const byLocal =
        q.local <= opts.maxQ && entry.localLiftLow >= opts.minLift;
      const channels: ClusterChannel[] = [];
      if (byParty) channels.push("party");
      if (byBurst) channels.push("burst");
      if (bySweep) channels.push("sweep");
      if (byLocal) channels.push("local");
      if (channels.length === 0) return;
      if (isNumberedFleet(entry.rows)) return;
      clusters.push(
        buildCluster({
          ...entry,
          kind,
          labels,
          partyQ: q.party,
          burstQ: q.burst,
          sweepQ: q.sweep,
          localQ: q.local,
          channels,
          sweptCompanies,
          maxHires: opts.maxHiresPerCluster,
        }),
      );
      backing.push(new Set(entry.rows.map((row) => row.edgeId)));
    });
  }

  return dropNearDuplicates(clusters, backing, opts.maxOverlap)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.maxClusters);
}

/** Two ways of naming the same story, reduced to the better one.
 *
 * A gmina owns the companies seated in it, so „Chełm” the region and „Gmina
 * Chełm” the owner are built from almost the same hires and would sit next to
 * each other at the top of the list saying the same thing twice. The keys are
 * still worth having separately - a województwo owns hospitals across a dozen
 * powiaty, and PKP owns companies seated nowhere near each other - so the fix
 * is not to drop a kind but to drop the weaker of any two clusters that are
 * mostly the same hires.
 *
 * Overlap is measured as the share of the SMALLER cluster contained in the
 * larger, not as a Jaccard: „Gmina Chełm” being a strict subset of „Chełm” is
 * exactly the case worth catching, and a Jaccard would score it 0.75 or 0.5
 * depending on how much bigger the region is.
 */
function dropNearDuplicates(
  clusters: StoryCluster[],
  backing: Set<string>[],
  maxOverlap: number,
): StoryCluster[] {
  const order = clusters
    .map((cluster, index) => ({ cluster, index }))
    .sort((a, b) => b.cluster.score - a.cluster.score);
  const kept: { cluster: StoryCluster; edges: Set<string> }[] = [];
  for (const { cluster, index } of order) {
    const edges = backing[index]!;
    const duplicate = kept.some((other) => {
      let shared = 0;
      for (const edge of edges) if (other.edges.has(edge)) shared += 1;
      const smaller = Math.min(edges.size, other.edges.size);
      return smaller > 0 && shared / smaller > maxOverlap;
    });
    if (!duplicate) kept.push({ cluster, edges });
  }
  return kept.map((entry) => entry.cluster);
}

function buildCluster(input: {
  kind: ClusterKind;
  key: string;
  rows: ClusterHire[];
  labels: ClusterLabels;
  expected: number;
  partyP: number;
  partyQ: number;
  partyLift: number;
  partyLiftLow: number;
  burstP: number;
  burstQ: number;
  burstLift: number;
  burstLiftLow: number;
  swept: number;
  sweepP: number;
  sweepQ: number;
  sweepLift: number;
  sweepLiftLow: number;
  sweepExpected: number;
  partyPUnpublished: number;
  channels: ClusterChannel[];
  localP: number;
  localQ: number;
  localLift: number;
  localLiftLow: number;
  localExpected: number;
  sweptCompanies: Set<string>;
  maxHires: number;
}): StoryCluster {
  const { kind, key, rows } = input;

  const partyMix = partyCounts(rows);
  const labelled = rows.filter((hire) => partiesOf(hire).length > 0).length;
  let dominantParty: string | undefined;
  let dominantCount = 0;
  for (const [party, count] of Object.entries(partyMix)) {
    if (count <= dominantCount) continue;
    dominantCount = count;
    dominantParty = party;
  }

  /* Companies per person, so that a crew is the people who turn up in more than
   * one of them. Bounded to this cluster on purpose: a member of four boards
   * across four voivodeships says something about them, not about this place. */
  const companiesByPerson = new Map<string, Set<string>>();
  for (const hire of rows) {
    const seen = companiesByPerson.get(hire.personId) ?? new Set<string>();
    seen.add(hire.companyId);
    companiesByPerson.set(hire.personId, seen);
  }
  const crew: ClusterCrewMember[] = [];
  for (const [personId, companies] of companiesByPerson) {
    if (companies.size < 2) continue;
    const hire = rows.find((h) => h.personId === personId)!;
    crew.push({
      personId,
      personName: hire.personName,
      companies: companies.size,
      parties: hire.parties,
    });
  }
  crew.sort((a, b) => b.companies - a.companies);

  const sectors = Object.entries(
    countBy(
      rows.flatMap((h) => h.categories.map((category) => ({ category }))),
      (row) => row.category,
    ),
  )
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));

  /* Visible first, then newest first. A public card shows the hires a reader
   * can open; an editor reading the same document through `?latest=true` gets
   * the drafts after them rather than instead of them. */
  const ordered = [...rows].sort((a, b) => {
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    return b.start.localeCompare(a.start);
  });

  const starts = rows.map((h) => h.start).sort();

  /* Months between the first swept company and the last, so that a group whose
   * boards all changed inside one autumn reads differently from one that
   * changed the same number over two years. Floored at one month: everything
   * happening on a single day is the sharpest rollout there is, not an
   * undefined one. */
  const sweptStarts = rows
    .filter((hire) => input.sweptCompanies.has(hire.companyId))
    .map((hire) => hire.start)
    .sort();
  const rolloutMonths =
    sweptStarts.length > 1
      ? Math.max(
          1,
          monthsBetween(sweptStarts[0]!, sweptStarts[sweptStarts.length - 1]!),
        )
      : 1;
  const rolloutPerMonth = input.swept / rolloutMonths;

  /* An owner group split by name stem is named after the stem, with the owner
   * underneath: „POLSKIE RADIO”, „właściciel: Skarb Państwa”. The other way
   * round would put the same six words at the top of every one of Skarb
   * Państwa's groups. */
  const named = nameCluster(key, input.labels);

  const cluster: StoryCluster = {
    id: `${kind}:${key}`,
    kind,
    key,
    title: named.title,
    known: rows.length,
    visible: rows.filter((h) => h.visible).length,
    companies: new Set(rows.map((h) => h.companyId)).size,
    expected: Math.round(input.expected * 10) / 10,
    partyMix,
    dominantCount,
    labelled,
    partyP: input.partyP,
    partyQ: input.partyQ,
    partyLift: round2(input.partyLift),
    partyLiftLow: round2(input.partyLiftLow),
    burstP: input.burstP,
    burstQ: input.burstQ,
    burstLift: round2(input.burstLift),
    burstLiftLow: round2(input.burstLiftLow),
    swept: input.swept,
    sweepExpected: round2(input.sweepExpected),
    partyPUnpublished: input.partyPUnpublished,
    partyIsEditorialArtifact:
      input.channels.includes("party") && input.partyPUnpublished > 0.05,
    channels: input.channels,
    sweepP: input.sweepP,
    sweepQ: input.sweepQ,
    sweepLift: round2(input.sweepLift),
    sweepLiftLow: round2(input.sweepLiftLow),
    rolloutPerMonth: round2(rolloutPerMonth),
    localCandidates: rows.filter((h) => h.localCandidate).length,
    localExpected: round2(input.localExpected),
    localP: input.localP,
    localQ: input.localQ,
    localLift: round2(input.localLift),
    localLiftLow: round2(input.localLiftLow),
    crew,
    sectors,
    hires: ordered.slice(0, input.maxHires).map((hire) => ({
      edgeId: hire.edgeId,
      personId: hire.personId,
      personName: hire.personName,
      parties: hire.parties,
      companyId: hire.companyId,
      companyName: hire.companyName,
      role: hire.role ?? null,
      start: hire.start,
      visible: hire.visible,
      localCandidate: hire.localCandidate,
    })),
    firstStart: starts[0]!,
    lastStart: starts[starts.length - 1]!,
    score: 0,
  };
  if (named.subtitle) cluster.subtitle = named.subtitle;
  if (dominantParty) cluster.dominantParty = dominantParty;
  if (kind !== "sector") cluster.nodeId = key;
  const teryt = input.labels.teryts?.[key];
  if (teryt) cluster.teryt = teryt;
  cluster.score = clusterScore(cluster);
  return cluster;
}
