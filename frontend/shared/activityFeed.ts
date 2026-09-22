import {
  polishCounting,
  polishCountingGenitive,
} from "../app/composables/polish";
import type { NodeType } from "./model";

/** What `/aktywnosc` lists: the things people did to the data, one line per
 * person per sitting.
 *
 * Deliberately not the four kinds of `shared/activity.ts`. That list counts
 * work for a chart and folds everything an administrator decides into one
 * number; this one has to say what somebody actually did, so a publication, a
 * rejection and a merge are told apart - which is the whole point of watching
 * what a new administrator is doing. The two lists also count differently: a
 * note here is one document per (author, page), because its sources carry no
 * dates of their own and "added four sources" would be a guess for a note that
 * was only edited.
 *
 * The audit actions keep the names `shared/audit.ts` gives them, so a new action
 * there is a type error here (the verb table below is keyed on every kind)
 * rather than a row silently dropped.
 */
export const feedKinds = [
  // What any signed-in contributor does.
  "vote",
  "note",
  "proposal",
  // What only an administrator can do. `edit` is a change written straight
  // into the data without review (an admin editing a relation), `splitMark` is
  // a page flagged as two people without being split yet, and `import` is what
  // an administrator who also holds `datascience` uploaded through the ingest
  // endpoints - which publish without leaving an audit row.
  "edit",
  "approve",
  "reject",
  "publish",
  "unpublish",
  "delete",
  "merge",
  "split",
  "splitMark",
  "import",
] as const;

export type FeedKind = (typeof feedKinds)[number];

/** The filter chips on the page, each a set of kinds. */
export const feedKindGroups = {
  oceny: ["vote"],
  propozycje: ["proposal"],
  notatki: ["note"],
  decyzje: [
    "edit",
    "approve",
    "reject",
    "publish",
    "unpublish",
    "delete",
    "merge",
    "split",
    "splitMark",
    "import",
  ],
} as const satisfies Record<string, readonly FeedKind[]>;

export type FeedKindGroup = keyof typeof feedKindGroups;

export const feedKindGroupLabels: Record<FeedKindGroup, string> = {
  oceny: "Oceny",
  propozycje: "Propozycje",
  notatki: "Notatki",
  decyzje: "Decyzje administratorów",
};

/** Kinds only an established administrator sees, besides the person who did
 * them. A rejection shown to every contributor is a public "no" next to a
 * proposal whose author is one hover away, and an import is only ever listed
 * for administrators on trial - it is monitoring, not news. */
export const restrictedFeedKinds: readonly FeedKind[] = ["reject", "import"];

/** The windows `/api/activity/feed` answers for, in days. A closed set for the
 * same reason as `activityRanges`: every value is its own memo entry and its
 * own scan. */
export const feedRanges = [7, 30] as const;

export type FeedRange = (typeof feedRanges)[number];

export const defaultFeedRange: FeedRange = 7;

/** Two actions of one kind by one person belong to the same batch while each
 * follows the previous within this long. Long enough that a sitting with a
 * coffee break in it stays one line, short enough that the morning and the
 * evening are two. */
export const FEED_BATCH_GAP_MS = 2 * 60 * 60 * 1000;

/** What a feed line can point at: a page of one of the node types, a fact the
 * extraction pipeline proposed, or a relation between two pages. */
export type FeedTargetType = NodeType | "fact" | "edge";

/** The order per-type counts are listed in, so "3 osoby i 2 fakty" never comes
 * back as "2 fakty i 3 osoby" for the same batch. */
export const feedTargetTypes: readonly FeedTargetType[] = [
  "person",
  "place",
  "region",
  "topic",
  "article",
  "fact",
  "edge",
];

/** Accusative singular, nominative plural, genitive plural - the three forms a
 * direct object takes after a count ("ocenił/a 1 osobę / 3 osoby / 5 osób").
 * None of these nouns is masculine-personal, so the accusative plural is the
 * nominative plural and `polishCounting` picks the right one. */
const targetNouns: Record<FeedTargetType, [string, string, string]> = {
  person: ["osobę", "osoby", "osób"],
  place: ["instytucję", "instytucje", "instytucji"],
  region: ["region", "regiony", "regionów"],
  topic: ["temat", "tematy", "tematów"],
  article: ["artykuł", "artykuły", "artykułów"],
  fact: ["fakt", "fakty", "faktów"],
  edge: ["powiązanie", "powiązania", "powiązań"],
};

/** The verb for each kind, in the neutral "/a" form the site already writes
 * ("Oznaczył/a", "pracował/a w"). Nothing stores anybody's grammatical gender
 * and a display name is no way to guess it; keyed per kind so a per-person form
 * can be added later without touching the sentences. */
export const feedVerbs: Record<FeedKind, string> = {
  vote: "ocenił/a",
  note: "dodał/a",
  proposal: "zaproponował/a",
  edit: "poprawił/a",
  approve: "zatwierdził/a",
  reject: "odrzucił/a",
  publish: "opublikował/a",
  unpublish: "ukrył/a",
  delete: "usunął/usunęła",
  merge: "scalił/a",
  split: "rozdzielił/a",
  splitMark: "oznaczył/a",
  import: "wgrał/a automatycznie",
};

/** Kinds whose object is not the pages themselves but a count of something
 * else - a proposal is a change to a page, and three changes to one page are
 * three proposals. Everything else names what it touched, by type. */
const countedNouns: Partial<Record<FeedKind, [string, string, string]>> = {
  note: ["notatkę", "notatki", "notatek"],
  proposal: ["zmianę", "zmiany", "zmian"],
  approve: ["propozycję", "propozycje", "propozycji"],
  reject: ["propozycję", "propozycje", "propozycji"],
  merge: ["duplikat", "duplikaty", "duplikatów"],
  import: ["zmianę", "zmiany", "zmian"],
};

/** The kinds whose `count` is of the documents behind a batch - votes, notes,
 * revisions, a merge's duplicates - rather than of the pages it touched. The
 * server counts by this set and the sentence words by `countedNouns`, so the
 * two cannot disagree about which kinds they are. */
export const countedFeedKinds: ReadonlySet<FeedKind> = new Set(
  Object.keys(countedNouns) as FeedKind[],
);

/** Joins "12 osób", "1 instytucję", "3 fakty" the way Polish lists do: commas,
 * and "i" before the last one with no comma in front of it. */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} i ${parts[parts.length - 1]}`;
}

/** What a batch did, as the words after the actor's name: "ocenił/a 12 osób i
 * 3 fakty", "opublikował/a 3 osoby razem z 36 powiązaniami", "zatwierdził/a 5
 * propozycji".
 *
 * Plain text, never markup - the actor's name is rendered next to it by the
 * template, and page names are user input. */
export function describeFeedBatch(batch: {
  kind: FeedKind;
  count: number;
  objects: Partial<Record<FeedTargetType, number>>;
  alongEdges: number;
}): string {
  const verb = feedVerbs[batch.kind];
  const counted = countedNouns[batch.kind];
  if (counted) {
    return `${verb} ${polishCounting(batch.count, ...counted)}`;
  }

  const parts = feedTargetTypes
    .filter((type) => (batch.objects[type] ?? 0) > 0)
    .map((type) => polishCounting(batch.objects[type]!, ...targetNouns[type]));
  const object =
    parts.length > 0
      ? joinList(parts)
      : // Every batch has at least one target by construction; this is the
        // count on its own rather than an empty object if one ever does not.
        polishCounting(batch.count, "wpis", "wpisy", "wpisów");

  // The relations that went live, or were hidden, together with their page are
  // the same decision as the page (`activityKindDescriptions.publication` says
  // so for the stats), so they trail the sentence rather than being its object.
  const along =
    batch.alongEdges > 0
      ? ` razem z ${polishCountingGenitive(batch.alongEdges, "powiązaniem", "powiązaniami")}`
      : "";
  const tail = batch.kind === "splitMark" ? " do rozdzielenia" : "";

  return `${verb} ${object}${tail}${along}`;
}

/** How many more targets a batch touched than it lists, as the words after the
 * list. "i jeszcze N" agrees with every noun and every count, which "i N
 * innych" does not ("i 3 inne", "i 1 inną"). */
export function moreTargetsLabel(more: number): string {
  return `i jeszcze ${more}`;
}

// ---------------------------------------------------------------------------
// What the endpoint answers with, per caller.
// ---------------------------------------------------------------------------

/** One thing a line points at, as this caller may see it. */
export type FeedTarget = {
  /** Unique within the batch. The target's own id (a page, fact or relation
   * id - all of which appear in public URLs anyway), never a vote, note or
   * revision document id: those embed the author's uid. */
  key: string;
  type: FeedTargetType;
  name: string;
  /** Where to open it, or null when there is nowhere useful to go (a removed
   * page). A relation links to its source page. */
  href: string | null;
  deleted?: boolean;
  /** Established administrators only: the queue permalink of the revision
   * this line approved, rejected or proposed. */
  revisionHref?: string;
  /** Established administrators only: the person approved or published their
   * own proposal. */
  selfApproved?: boolean;
  /** Established administrators only: why it was rejected, removed, merged or
   * split, when a reason was given. */
  reason?: string;
};

export type FeedBatch = {
  /** Stable key for the list: actor key, kind and first instant. Never built
   * from a uid for a caller who is not an established administrator. */
  id: string;
  kind: FeedKind;
  actorKey: string;
  /** ISO instants of the first and the last action in the batch. */
  firstAt: string;
  lastAt: string;
  /** Units of the counted noun for kinds that have one (`countedNouns`),
   * otherwise the number of distinct targets. */
  count: number;
  /** Distinct targets per type, over the whole batch rather than the listed
   * slice - for the kinds whose sentence names them. A kind with a counted
   * noun words itself from `count`, and the server reads only the targets it
   * lists, so for those this covers what it could type without a read. */
  objects: Partial<Record<FeedTargetType, number>>;
  /** Relations published or hidden together with the pages of a `publish` or
   * `unpublish` batch. They are counted here and not listed - except one the
   * publisher had proposed themselves, which is listed, flagged and counted in
   * `objects` instead, because that is the one worth checking. */
  alongEdges: number;
  /** Newest first, capped; `moreTargets` says how many were left out. */
  targets: FeedTarget[];
  moreTargets: number;
};

export type FeedActor = {
  /** The uid for an established administrator; otherwise `self`, `named-N`
   * or `anon-N`, numbered by first appearance in this one response - so a key
   * is only good for filtering within the response it came in. */
  key: string;
  /** Established administrators only. */
  uid: string | null;
  /** Never empty: a masked person reads "Anonim 3", not a blank. */
  name: string;
  /** Whether `name` is the person's own name rather than a mask. */
  named: boolean;
  isSelf: boolean;
  /** Set only on the caller's own actor: whether everybody else is shown this
   * name too. `named` cannot say so - your own name is shown to you whatever
   * the setting - and the chip's tooltip tells you which it is. */
  publicName?: boolean;
  /** Always null here. An avatar is a URL the account holder chose, and every
   * administrator's browser would fetch it; the chip shows an icon instead. */
  photoURL: null;
  /** Established administrators only: this person is an administrator on
   * trial (`newAdmin` claim). */
  newAdmin: boolean;
};

export type ActivityFeed = {
  window: { since: string; until: string; days: FeedRange };
  /** The caller is an established administrator (admin, not on trial), and so
   * sees every name, uid, reason and revision link. */
  identified: boolean;
  /** Everybody a batch refers to, in order of first appearance. */
  actors: FeedActor[];
  /** Newest first by `lastAt`. */
  batches: FeedBatch[];
  /** Established administrators only: every administrator on trial right
   * now, whether or not they did anything in the window. */
  newAdmins: FeedActor[];
  /** Sources whose scan hit its cap, so the window is a lower bound for them. */
  truncated: string[];
};

// ---------------------------------------------------------------------------
// What the server builds once per window and keeps in its memo. Holds uids and
// every restricted field; `present` in the endpoint strips it per caller.
// ---------------------------------------------------------------------------

export type RawFeedTarget = {
  id: string;
  type: FeedTargetType;
  name: string;
  href: string | null;
  deleted?: boolean;
  revisionId?: string;
  selfApproved?: boolean;
  reason?: string;
};

export type RawFeedBatch = {
  uid: string;
  kind: FeedKind;
  firstAt: string;
  lastAt: string;
  count: number;
  objects: Partial<Record<FeedTargetType, number>>;
  alongEdges: number;
  targets: RawFeedTarget[];
  moreTargets: number;
};

export type RawFeed = {
  batches: RawFeedBatch[];
  truncated: string[];
};
