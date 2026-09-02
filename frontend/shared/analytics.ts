/** Every custom event the site is allowed to send to Plausible, in one place.
 *
 * ## Why a closed vocabulary
 *
 * Plausible only *counts* an event it has been told about: an event whose name
 * is not registered as a goal on the dashboard is accepted, stored and then
 * invisible. So the set has to be enumerable to be set up at all - `ALL_GOALS`
 * is the list to paste into Settings -> Goals, and the descriptions here are
 * what the goal means to somebody reading the dashboard in six months.
 *
 * ## Properties carry the dimensions
 *
 * The site is on a **Business** plan, so custom properties exist and can be
 * filtered and grouped by. That is why there is one `search:pick` with a `kind`
 * property rather than five goals with the kind spelled into the name, and one
 * `tabela:filter` rather than one goal per control on the filter bar. Each goal
 * declares the property keys it carries and `trackGoal` requires exactly those,
 * so a property cannot be quietly renamed at one call site and left behind at
 * another.
 *
 * Two things follow from properties being real stored data rather than
 * something the API drops:
 *
 * - **No free text.** A search query is somebody's name and a note is somebody's
 *   words; neither belongs in analytics. Properties here are closed sets, site
 *   data (a party, a teryt, a filter name) or buckets. `resultBucket` exists
 *   because the number of hits is interesting and the query is not.
 * - **Bounded values where it costs nothing.** A property with a few dozen
 *   values reads as a breakdown; one with ten thousand reads as a list.
 *
 * ## Interactive vs passive
 *
 * A custom event counts towards Plausible's bounce rate unless it is sent with
 * `interactive: false` - the tracker puts it in the payload as `i`. So an event
 * that fires because a page loaded, rather than because a reader did something,
 * has to be declared `passive` here or it un-bounces every single visitor and
 * the bounce rate becomes 0% and meaningless.
 *
 * Note what this means for `/eksploruj/tabela`, whose 76% entry bounce rate is
 * the reason half of this file exists: once its interactions are counted, that
 * number will fall, because a reader who filtered and left was always engaged
 * and only looked like a bounce. The rate before and after this ships is not
 * the same measurement, and the day it deploys is a discontinuity in the chart.
 */

import type { NodeType } from "./model";

/** One goal: what it means, what it carries, and whether a reader did it.
 *
 * `props` is the exact set of property keys the goal takes - not a minimum.
 * Empty means the goal takes none. */
type GoalSpec = {
  description: string;
  props: readonly string[];
  /** True when the event fires from a page load rather than from something the
   * reader did. Sent as `interactive: false`, so it does not touch the bounce
   * rate. Defaults to false, i.e. the reader did it. */
  passive?: true;
};

/** The naming rule: `<surface>:<what happened>`, kebab-case, and the surface is
 * where the reader was rather than which component fired it.
 * `home-explorer:tab` survives the component being renamed; `Explorer:tabChange`
 * would not. */
export const GOALS = {
  // --- The home page explorer -------------------------------------------
  // These exist to answer one question without splitting traffic: of the
  // people who land on `/` - 73% of all entrances - does anybody go to the
  // party treemap, and does either panel send them anywhere? The tab strip is
  // already there and already switchable, so the answer is observable as soon
  // as it is measured. Only then is an experiment on the *default* tab worth
  // the traffic it would cost.
  "home-explorer:tab": {
    description:
      "Reader switched the home explorer's panel. Break down by `tab` for how many people ever open the treemap - the whole case for or against making it the default.",
    props: ["tab"],
  },
  "home-explorer:pick": {
    description:
      "Reader clicked through from one of the home explorer's panels into the data - a powiat on the map, a party in the treemap. One goal for both, so `panel` compares them directly: this is each panel's conversion rate.",
    props: ["panel", "value"],
  },

  // --- Search -----------------------------------------------------------
  // OmniSearch is the first thing on a phone and the site has no idea whether
  // anything came back or whether the reader took what it offered.
  "search:performed": {
    description:
      "A search query reached /api/search. `results` buckets how many came back; `none` against the total is the share of searches the index cannot answer. The query itself is deliberately not recorded.",
    props: ["results"],
  },
  "search:pick": {
    description:
      "Reader opened something from the search results. `kind` separates a real hit from „Lista wszystkich osób” and the party shortcuts - one is a reader with a name in mind, the other is a reader giving up on typing one.",
    props: ["kind"],
  },
  "search:propose": {
    description:
      "Reader started adding something the search could not find. Whether they finished is a different question, and the revision queue already answers it.",
    props: ["kind"],
  },

  // --- The contribution funnel -----------------------------------------
  // The volunteer form is an outbound Google Forms link and has been the site's
  // main ask since it launched. Nobody has ever been able to say whether one
  // person clicked it.
  "cta:volunteer-form": {
    description:
      "Reader clicked through to the volunteer Google Form. The site's primary conversion.",
    props: ["from"],
  },
  "cta:pomoc": {
    description: "Reader went to /pomoc from a call to action.",
    props: ["from"],
  },
  "cta:donate": {
    description: "Reader clicked through to Patronite or Zrzutka.",
    props: ["to"],
  },
  "cta:community": {
    description:
      "Reader clicked through to Slack, Discord, Facebook or the GitHub issue tracker.",
    props: ["to"],
  },

  // --- /eksploruj/tabela -------------------------------------------------
  // The #2 page, 2,068 visitors, and 76% of the people who enter on it bounce.
  // Nothing could say why, and one detail makes that worse than it sounds: the
  // tracker fires a pageview only when `location.pathname` changes, and every
  // control on this page writes to the query string instead. A reader who spent
  // five minutes filtering, sorting and paging produced exactly one pageview.
  "tabela:open": {
    description:
      "Reader arrived at the table. `filtered` splits cold arrivals from arrivals with intent - from search, a party chip, the home map or a shared link - and `filters` says which ones they came with.",
    props: ["filtered", "filters"],
    // Fires on mount. Interactive, this would un-bounce every visitor to the
    // page and take the number it exists to explain down to zero.
    passive: true,
  },
  "tabela:filter": {
    description:
      "Reader changed one of the filters. Break down by `filter` for whether the bar earns the space it takes - note that visibility, voted and min-votes are only shown to a signed-in reader, so they measure the tagging workflow rather than the public.",
    props: ["filter"],
  },
  "tabela:filter-cleared": {
    description:
      "Reader emptied every filter at once with „Wyczyść”. One event, not one per filter dropped.",
    props: ["dropped"],
  },
  "tabela:sorted": {
    description: "Reader reordered the table.",
    props: ["by", "order"],
  },
  "tabela:paged": {
    description:
      "Reader went past the first page, or asked for more rows. On a table whose readers mostly bounce, getting to row 11 is the strongest engagement signal there is.",
    props: ["kind", "to"],
  },
  "tabela:row-opened": {
    description:
      "Reader opened a person's drawer from a row. The table's conversion - everything else on the page is in service of this.",
    props: [],
  },
  "tabela:no-results": {
    description:
      "A filter combination came back empty. The cheapest explanation for a reader who filters once and leaves.",
    props: ["filters"],
    // Passive because it also fires for an arrival whose incoming filter finds
    // nobody, and being shown an empty table is not something the reader did.
    passive: true,
  },
  "tabela:shared": {
    description: "Reader copied a link to the filtered table.",
    props: [],
  },

  // --- Experiments -------------------------------------------------------
  "experiment:assigned": {
    description:
      "Records which arm a reader was put in, once per session per experiment. The arm also rides as a property on every other goal, so this exists to give each arm a denominator.",
    props: ["experiment", "arm"],
    // Fires on mount, before the reader has done anything.
    passive: true,
  },
} as const satisfies Record<string, GoalSpec>;

export type AnalyticsGoal = keyof typeof GOALS;

/** The property keys `goal` carries. */
export type GoalPropKeys<G extends AnalyticsGoal> =
  (typeof GOALS)[G]["props"][number];

/** Every goal name, for pasting into Plausible -> Settings -> Goals.
 *
 * Sorted, because the dashboard lists goals in creation order and comparing an
 * unsorted list against it by eye is how one gets missed. */
export const ALL_GOALS: AnalyticsGoal[] = (
  Object.keys(GOALS) as AnalyticsGoal[]
).sort();

/** Whether `goal` fires from a page load rather than from a reader's action. */
export function isPassiveGoal(goal: AnalyticsGoal): boolean {
  return "passive" in GOALS[goal] && GOALS[goal].passive === true;
}

// --- search -------------------------------------------------------------

/** What a search result can be, for `search:pick`'s `kind`.
 *
 * Wider than the node types the endpoint returns: „Lista wszystkich osób” and
 * the parties are entries OmniSearch builds itself and never asks the server
 * about. */
export const SEARCH_PICK_KINDS = [
  "person",
  "place",
  "region",
  "party",
  "list",
] as const;
export type SearchPickKind = (typeof SEARCH_PICK_KINDS)[number];

/** Only these three: /api/search filters on `type in ["person", "place",
 * "region"]`, so an article or a topic reaching the results would be a change
 * to the search rather than a case to handle here. The `NodeType` constraint is
 * what keeps the keys honest if one of them is ever renamed. */
const SEARCH_KINDS_BY_NODE_TYPE = {
  person: "person",
  place: "place",
  region: "region",
} as const satisfies Partial<Record<NodeType, SearchPickKind>>;

/** Which `kind` a search hit of `nodeType` is.
 *
 * A runtime lookup rather than an indexed type, because the type arrives over
 * the wire as a plain string - the endpoint returns whatever Firestore holds,
 * and a document with an unexpected `type` should still show up under some kind
 * rather than crash the search box. */
export function searchPickKind(nodeType: string | undefined): SearchPickKind {
  return (
    (SEARCH_KINDS_BY_NODE_TYPE as Record<string, SearchPickKind>)[
      nodeType ?? ""
    ] ?? "place"
  );
}

/** The things OmniSearch offers to create when it finds nothing. */
export type SearchProposeKind = "person" | "place" | "article";

/** How many results a search returned, as something a dashboard can group by.
 *
 * Bucketed rather than exact: the interesting distinctions are "nothing",
 * "a short list the reader can read" and "too many to choose from", and a
 * property with one value per possible count is a list rather than a breakdown.
 */
export function resultBucket(count: number): string {
  if (count === 0) return "none";
  if (count <= 4) return "1-4";
  if (count <= 20) return "5-20";
  return "21+";
}

// --- /eksploruj/tabela filters -------------------------------------------

/** The name each of the table's url parameters is reported under.
 *
 * Keyed by url parameter rather than by control, because that is where the page
 * keeps its filter state: every control on the bar is a writable computed over
 * `route.query`, so one watcher over these keys sees every filter, every chip's
 * close button and every legacy spelling, and cannot drift when a control is
 * added or moved.
 *
 * Two pairs map onto one name: `parties`/`party` and `krs`/`place` are the same
 * filter under an older spelling that links minted before the rename still
 * carry. Paging, sorting and row count are deliberately absent - they are the
 * table's own state, not filters, and they have goals of their own.
 */
export const TABELA_FILTER_NAMES = {
  party: "party",
  parties: "party",
  teryt: "region",
  companyTeryt: "company-region",
  place: "company",
  krs: "company",
  category: "category",
  currentlyEmployed: "currently-employed",
  minEmploymentDate: "employed-since",
  visibility: "visibility",
  hideVoted: "voted",
  minVotes: "min-votes",
} as const satisfies Record<string, string>;

export type TabelaFilterKey = keyof typeof TABELA_FILTER_NAMES;

const TABELA_FILTER_KEYS = Object.keys(
  TABELA_FILTER_NAMES,
) as TabelaFilterKey[];

/** A url query as the router hands it over: a string, a list, or nothing. */
type QueryValue = string | null | undefined | (string | null)[];
export type TabelaQuery = Partial<Record<string, QueryValue>>;

/** Whether `value` means the filter is on.
 *
 * An empty string and an empty array are both "off": `stringFilter` leaves a
 * cleared text filter as `""` rather than removing the key, and a multi-select
 * emptied down to nothing does the same. Counting those as filters would report
 * every reader who cleared one chip as still filtering. */
function isSet(value: QueryValue): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((entry) => !!entry);
  return value !== "";
}

/** The filters carrying a value in `query`, by reported name and deduplicated.
 *
 * Used for the arrival split - a reader who lands with one of these came from
 * search, a chip or a shared link, and wanted something specific. */
export function activeTabelaFilters(query: TabelaQuery): string[] {
  const names = new Set<string>();
  for (const key of TABELA_FILTER_KEYS) {
    if (isSet(query[key])) names.add(TABELA_FILTER_NAMES[key]);
  }
  return [...names].sort();
}

/** Comparable form of a query value, so `["pis"]` and `"pis"` are one filter.
 *
 * The router gives a single-valued parameter as a string and a repeated one as
 * an array, and which of the two a filter arrives as depends on how the url was
 * written rather than on what it means. */
function normalise(value: QueryValue): string {
  if (value == null) return "";
  return (Array.isArray(value) ? value : [value])
    .filter((entry): entry is string => !!entry)
    .join(",");
}

/** The filters a move from `before` to `after` touched, deduplicated.
 *
 * Deduplicated because of the shared keys above: switching an employer from a
 * `krs` link to a picked `place` changes two parameters and is one thing the
 * reader did. Clearing counts as changing - dropping the one party chip is
 * using the party filter - which is why „Wyczyść” is not routed through here;
 * it would report eight filters used by somebody who used none.
 */
export function tabelaFiltersChanged(
  before: TabelaQuery,
  after: TabelaQuery,
): string[] {
  const names = new Set<string>();
  for (const key of TABELA_FILTER_KEYS) {
    if (normalise(before[key]) !== normalise(after[key])) {
      names.add(TABELA_FILTER_NAMES[key]);
    }
  }
  return [...names].sort();
}
