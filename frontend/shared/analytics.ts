/** Every custom event the site is allowed to send to Plausible, in one place.
 *
 * Two reasons this is a closed vocabulary rather than string literals at the
 * call sites.
 *
 * The first is that Plausible only *counts* an event it has been told about:
 * an event whose name is not registered as a goal on the dashboard is accepted,
 * stored and then invisible. So the set has to be enumerable to be set up at
 * all - `ALL_GOALS` below is the list to paste into Settings -> Goals, and
 * `analytics.test.ts` fails if a name is added here without a description, so
 * the list stays the documentation of what each goal means.
 *
 * The second is that koryta.pl is on a Growth plan, where **custom properties
 * do not exist**. On Business you would send `track("search", { props: { kind:
 * "person" }})` and break the goal down by `kind` in the dashboard; on Growth
 * that property is accepted by the API and then dropped. Any dimension worth
 * having therefore has to be part of the goal *name*, which is why the names
 * below read `search:pick-person` rather than `search:pick`. That trades a
 * longer goal list for being able to see the answer, and it is the reason the
 * vocabulary has to stay small - a dimension with more than a handful of values
 * (a powiat, a person) must not go in a name. `home-map:region` is one goal for
 * all 380 powiaty on purpose.
 *
 * Properties are sent anyway, by `useAnalytics`, where they add something. They
 * cost nothing today and mean a later upgrade to Business starts producing
 * breakdowns without another pass over the call sites.
 */

import type { NodeType } from "./model";

/** The naming rule, such as it is: `<surface>:<what happened>`, kebab-case,
 * present tense, and the surface is where the reader was rather than which
 * component fired it. `home-explorer:tab-parties` survives the component being
 * renamed; `Explorer:tabChange` would not. */
export type AnalyticsGoal = keyof typeof GOAL_DESCRIPTIONS;

/** What each goal means, in the terms someone reading the dashboard needs.
 *
 * Write these for the person looking at a number six months from now who did
 * not write the code - "which of the two panels people actually open" is useful,
 * "fires on tab change" is not.
 */
export const GOAL_DESCRIPTIONS = {
  // --- The home page explorer -------------------------------------------
  // These four exist to answer one question without splitting traffic: of the
  // people who land on `/` - 73% of all entrances - does anybody go to the
  // party treemap, and does either panel send them anywhere? The tab strip is
  // already there and already switchable, so the answer is observable as soon
  // as it is measured. Only then is an experiment on the *default* tab worth
  // the traffic it would cost.
  "home-explorer:tab-map": "Reader switched the home explorer back to the map.",
  "home-explorer:tab-parties":
    "Reader opened the party treemap on the home page. The count of people who ever do this is the whole case for or against making it the default.",
  "home-map:region":
    "Reader clicked a powiat on the home map, which filters the list beside it. The map's only conversion.",
  "home-parties:party":
    "Reader clicked a party in the treemap, which opens the table filtered to it. The treemap's only conversion, and the one comparable to home-map:region.",

  // --- Search -----------------------------------------------------------
  // OmniSearch is the first thing on a phone and the site has no idea what is
  // typed into it, whether anything came back, or whether the reader took what
  // it offered.
  "search:performed": "A search query actually reached /api/search.",
  "search:no-results":
    "A search returned nothing. The gap between this and search:performed is the honest measure of whether the index covers what people look for.",
  "search:pick-person": "Reader opened a person from the search results.",
  "search:pick-place": "Reader opened an institution or company from search.",
  "search:pick-region": "Reader opened a region from search.",
  "search:pick-party":
    "Reader picked a party from search, which opens the table filtered to it.",
  "search:pick-list":
    "Reader picked „Lista wszystkich osób”, the entry that is always first.",
  "search:propose-person":
    "Reader started adding a person the search could not find.",
  "search:propose-place":
    "Reader started adding an institution the search could not find.",
  "search:propose-article":
    "Reader started adding a source the search could not find.",

  // --- The contribution funnel -----------------------------------------
  // The volunteer form is an outbound Google Forms link and has been the site's
  // main ask since it launched. Nobody has ever been able to say whether one
  // person clicked it. `autoOutboundTracking` counts outbound clicks in
  // aggregate, but on Growth the url is a property, so it cannot say *which*
  // link - hence a named goal for the ones that matter.
  "cta:volunteer-form":
    "Reader clicked through to the volunteer Google Form. The site's primary conversion.",
  "cta:pomoc": "Reader went to /pomoc from a call to action.",
  "cta:donate":
    "Reader clicked through to Patronite or Zrzutka. Both are outbound.",
  "cta:community":
    "Reader clicked through to Slack, Discord, Facebook or the GitHub issue tracker from /pomoc.",
} as const satisfies Record<string, string>;

/** Every goal name, for pasting into Plausible -> Settings -> Goals.
 *
 * Sorted, because the dashboard lists goals in creation order and comparing an
 * unsorted list against it by eye is how one gets missed. */
export const ALL_GOALS: AnalyticsGoal[] = (
  Object.keys(GOAL_DESCRIPTIONS) as AnalyticsGoal[]
).sort();

/** Everything a search result can be, mapped onto the goal picking it converts.
 *
 * Wider than the node types the endpoint returns: „Lista wszystkich osób” and
 * the parties are entries OmniSearch builds itself and never asks the server
 * about, and they are worth telling apart from a hit - one is a reader with a
 * name in mind, the other is a reader giving up on typing one.
 *
 * A map rather than a built name, so a new kind is a type error here instead of
 * a goal Plausible silently drops on the floor. */
export const SEARCH_PICK_GOALS = {
  person: "search:pick-person",
  place: "search:pick-place",
  region: "search:pick-region",
  party: "search:pick-party",
  list: "search:pick-list",
} as const satisfies Record<string, AnalyticsGoal>;

export type SearchPickKind = keyof typeof SEARCH_PICK_GOALS;

/** How a hit from /api/search counts.
 *
 * Only these three: the endpoint filters on `type in ["person", "place",
 * "region"]` (`server/api/search.get.ts`), so an article or a topic reaching
 * the results would be a change to the search rather than a case to handle
 * here. The `NodeType` constraint is what keeps the keys honest if one of them
 * is ever renamed. */
const SEARCH_KINDS_BY_NODE_TYPE = {
  person: "person",
  place: "place",
  region: "region",
} as const satisfies Partial<Record<NodeType, SearchPickKind>>;

/** Which pick goal a search hit of `nodeType` converts.
 *
 * A runtime lookup rather than an indexed type, because the type arrives over
 * the wire as a plain string - the endpoint returns whatever Firestore holds,
 * and a document with a `type` nobody expected should show up in the results
 * under some goal rather than crash the search box. "place" is the fallback for
 * the same reason the component uses it as its icon default. */
export function searchPickKind(nodeType: string | undefined): SearchPickKind {
  return (
    (SEARCH_KINDS_BY_NODE_TYPE as Record<string, SearchPickKind>)[
      nodeType ?? ""
    ] ?? "place"
  );
}

/** The three things OmniSearch offers to create when it finds nothing. */
export const SEARCH_PROPOSE_GOALS = {
  person: "search:propose-person",
  place: "search:propose-place",
  article: "search:propose-article",
} as const satisfies Record<string, AnalyticsGoal>;

export type SearchProposeKind = keyof typeof SEARCH_PROPOSE_GOALS;
