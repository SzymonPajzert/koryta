import type { Timestamp } from "firebase-admin/firestore";
import type { QaCheckStatus } from "./qa";
import type { SupervisoryOrgan } from "./companyOrgans";

type PageBase<PageType> = {
  id?: string;
  type: PageType;
  content?: string;
  /** The approved revision of the page. Approval alone does not make the page
   * visible to the public — that is controlled by `published`. */
  revision_id?: string | { path: string };
  /** Whether the page is publicly visible. Toggled by admins independently of
   * revision approval, so a node can have an approved revision that is not
   * live yet. */
  published?: boolean;
  votes?: Votes;
  deleted?: boolean;
  delete_reason?: string;
  /** The page this one turned out to be a second copy of.
   *
   * Set only alongside `deleted`, and only by a merge: the duplicate keeps its
   * document so that its url, and the votes and revisions filed against it,
   * still resolve to something. Readers are sent to the surviving page rather
   * than to a 404, which is what makes an old link - or a search engine's
   * memory of one - worth keeping.
   *
   * Never a chain. A merge resolves the target's own `merged_into` first, so
   * every duplicate points straight at the page a reader should end up on. */
  merged_into?: string;
  /** Set where a page is known to be two people who were never told apart, and
   * nobody has separated them yet.
   *
   * The evidence is upstream and the work is by hand, so the two are hours or
   * days apart: `create_people_table` groups namesakes born within a year of
   * each other on purpose, and once their candidacies and posts are on one page
   * nothing stored says which of them belongs to whom. Marking is what keeps
   * the page on a list until somebody who can tell gets to it. */
  needs_split?: {
    reason: string;
    /** ISO 8601, UTC, like `AuditEntry.at`. */
    at: string;
    user: string;
  };
  visibility?: boolean;
  stats?: NodeStats;
  revisions?: NodeRevisions;
};

export interface NodeRevisions {
  latest_id: string;
  latest_time: string | null;
  total: number;
  has_unapproved: boolean;
}

type NodeEdgeStats = {
  /** Years spent employed in public companies, see `Company.isPublic`. */
  experienceMonths: number;
  /** Start of the most recent employment in a public company. */
  latestEmploymentStart?: string | null;
  /** Everything this node points at, of every edge type, plus the regions
   * above whatever it points at. Type-blind on purpose: it backs the
   * "region of a person" filter, which does not care why the two are linked. */
  targetNodeIds: string[];
  /** Companies this node is the registered seat of. Only on region nodes, and
   * only `seat` edges - `targetNodeIds` cannot answer this since the register's
   * shareholder lists arrived, because a gmina points at the companies it owns
   * as well as the ones seated in it. */
  seatNodeIds?: string[];
  /** Whether the person still holds a post in a public company. */
  currentlyEmployed: boolean;
  /** Public companies (and their regions) the person still holds a post in. */
  currentlyEmployedTargetNodeIds?: string[];
};

export interface NodeStats {
  isApproved: boolean;
  notesCount: number;
  votes: {
    interesting?: number;
    quality?: number;
    humanVoted?: boolean;
    /** How many people have voted on this node - not how much they said.
     *
     * `interesting` sums the verdicts, so a 4 is one enthusiast or four mild
     * opinions or four models agreeing, and the number alone cannot say which.
     * This is the count that tells them apart, and with `models` it is what
     * `VoteBreakdown` renders. Absent, rather than 0, when nobody has voted:
     * Firestore cannot query for a field that is not there, and writing a 0
     * onto every node in the graph to say "nothing happened" is a migration
     * with no reader. */
    humanCount?: number;
    lastVotedAt?: string;
    /** What each scoring model made of this person, keyed by its `userUid`.
     * Only the best of them is in `interesting`; this is what says which model
     * put them there. Absent when no model has an opinion. */
    models?: Record<string, number>;
    [key: string]: unknown;
  };
  edges: {
    all: NodeEdgeStats;
    approved: NodeEdgeStats;
  };
  nodeGroupSize?: number;
  people?: number;
}

export type VoteCategory =
  | "interesting"
  | "quality"
  | "correct"
  | "insufficient"
  /** The person node an extracted fact was matched to is not the person the
   * article is about. Its own axis, not a shade of `correct`: the sentence can
   * be a perfectly good fact about a namesake the graph has never heard of, and
   * the mention matcher is what needs telling.
   *
   * Like every other vote a person casts, it sets `humanVoted` - so flagging a
   * match, on its own, takes the fact out of the unreviewed backlog. That is
   * deliberate rather than incidental: somebody has looked at it. The review
   * flow keeps the reviewer on the card afterwards, so the usual path is a flag
   * and then a verdict. */
  | "wrongPerson";

export type Votes = Record<
  VoteCategory,
  {
    total: number;
    [userUid: string]: number;
  }
>;

export type VoteDocument = {
  // Either nodeId or extractionId is set.
  nodeId?: string;
  extractionId?: string;
  userUid: string;
  categoryVotes: Record<string, number>;
  // Free-text note the reviewer left alongside the verdict. Not aggregated —
  // it is read back only by whoever reviews the extraction pipeline.
  comment?: string;
  updatedAt?: string;
};

export type Node = PageBase<NodeType> & {
  name: string;
};

export interface Edge extends PageBase<EdgeType> {
  name?: string;
  source: string;
  label?: string; // a derivative of name, see graph/model.ts
  target: string;
  start_date?: string;
  end_date?: string;
  references?: string[];
  party?: string;
  committee?: string;
  position?: ElectionPosition;
  elected?: boolean;
  term?: string;
  by_election?: boolean;
}

export type ElectionPosition =
  | "Samorząd"
  | "Sejmik"
  | "Rada miasta"
  | "Rada gminy"
  | "Rada powiatu"
  | "Burmistrz"
  | "Wójt"
  | "Prezydent"
  | "Sejm"
  | "Senat"
  | "Parlament Europejski";

/** Whether a logged out visitor can see this page.
 *
 * Nothing to do with `Company.isPublic`, which is about who owns an
 * institution: a state-owned company can have a page nobody has published yet,
 * and a private one can have a page that has been live for months. The names
 * are close enough to swap by accident, so check which question is being asked
 * before reaching for either.
 */
export function pageIsPublic(node: { published?: unknown; deleted?: unknown }) {
  // An approved removal outranks everything else: the page is only still here
  // so that the decision, and the reason for it, stay on the record.
  if (node.deleted === true) return false;

  // `published` is the whole answer. It used to fall back to `!!revision_id`
  // for documents written before the field existed; /api/nodes/migratePublished
  // has since backfilled every one of them, and an absent field now means what
  // it says - a draft nobody has put live.
  return node.published === true;
}

/** Node data written through sanitizeFirestoreData stores arrays as objects
 * with numbered keys, so array fields have to be read tolerantly.
 *
 * `sanitizeFirestoreData` leaves a top-level array as an array, but it rewrote
 * every array it saw until 2026-07-28 and documents written before then still
 * carry `{"0": "PiS"}` where an array belongs - which is also the shape a
 * nested array is legitimately stored in. `array-contains` matches nothing
 * against a map and does not raise, so a read that assumes the array shape
 * silently loses the value rather than failing. Every read of `parties`,
 * `activity`, `categories` and `references` goes through here.
 *
 * `scripts/migrate/unwrap-array-fields.ts` repairs the documents; this is what
 * keeps reads working in the meantime, on both sides of the wire.
 *
 * Lives here rather than in `server/utils/nodeFilters`, which is where it was
 * written and where it is still exported from: that module reaches nitro's
 * `defineCachedFunction` through `server/utils/fetch`, so importing it from a
 * plain request handler pulls a cache into places that only wanted to read an
 * array. Nothing about the problem is server-side anyway - the same documents
 * reach the browser.
 */
export function asArray<T>(
  value: T[] | Record<string, T> | undefined | null,
): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value);
  return [];
}

/** Every kind of node, in one place.
 *
 * The tuple is the source of truth and `NodeType` is derived from it, so that
 * the handlers validating a `type` query parameter can say `z.enum(nodeTypes)`
 * rather than writing the list out again. Four of them used to, and none of the
 * four was found by the compiler when `topic` was added - a zod enum is a
 * runtime value, so the first sign would have been /api/nodes/[id] throwing on
 * a topic it had been asked for.
 */
export const nodeTypes = [
  "person",
  "place",
  "region",
  "article",
  "topic",
] as const;

export type NodeType = (typeof nodeTypes)[number];

/** Every kind of relation, in one place.
 *
 * The tuple is the source of truth and `EdgeType` is derived from it, the same
 * arrangement `nodeTypes` has and for the same reason: a handler validating a
 * `type` off the wire can say `z.enum(edgeTypes)` rather than writing the list
 * out again, and `/api/edges/create` accepted any string at all until it could.
 *
 * Individual types are documented on the union below.
 */
export const edgeTypes = [
  "employed",
  "connection",
  "mentions",
  /** Ownership: a shareholder, a parent company, the gmina that holds the
   * shares. Region -> company means the region *owns* it, which since the
   * `seat` split is a claim about shares rather than about geography. */
  "owns",
  /** Where a company is registered. Split out of `owns`, which meant both
   * "sits in" and "is owned by" and could not mean both once the register's
   * shareholder lists were ingested: a gmina that owns a company seated in the
   * next town would otherwise move it there. */
  "seat",
  "comment",
  "election",
  "tagged",
] as const;

export type EdgeType = (typeof edgeTypes)[number];

export const destinationAddText: Record<NodeType, string> = {
  person: "Dodaj osobę",
  place: "Dodaj firmę",
  article: "Dodaj artykuł",
  region: "Dodaj region",
  topic: "Dodaj temat",
};

export interface Person extends Omit<Node, "type"> {
  type: "person";
  parties?: string[];
  birthDate?: string;
  /** Education, as a line of prose rather than a code: the useful answer is
   * sometimes a degree ("magister inżynierii środowiska") and sometimes a
   * formation no degree scale covers ("duchowny prawosławny"), and no list of
   * levels holds both. Filled in by hand where somebody knows it. */
  education?: string;
  wikipedia?: string;
  rejestrIo?: string;
  /** Profile on ktomaco.pl, another public registry of company connections. */
  ktomaco?: string;
}

export interface ElectionRich {
  year?: string;
  location?: string;
  teryt?: string;
  position: string;
  committee?: string;
}

export type PersonRich = Person & {
  id: string;
  companies: (string | undefined)[];
  elections: ElectionRich[];
  experience: number;
  latestEmploymentStart?: string | null;
  /** Cities the person has worked in - the region of every company they hold
   * or held a post at, deduplicated.
   *
   * Absent rather than empty where the caller could not work them out: the
   * lookup needs the region collection (see `regionNamesByPlaceId`), which not
   * every view loads. An empty array means the question was asked and nothing
   * came back. */
  workLocations?: string[];
};

/** A node identified on the graph, carrying the extra fields a person has when
 * it happens to be one. What a view needs to show any node it is handed
 * without knowing its kind up front. */
export type NodeMaybeRich = {
  id: string;
  name: string;
  type: NodeType;
} & Partial<Omit<PersonRich, "id" | "name" | "type">>;

export interface Company extends Omit<Node, "type"> {
  type: "place";
  krsNumber?: string;
  /** REGON, from the statistical register: nine digits, or fourteen for a
   * local unit of an entity.
   *
   * KRS only covers entities that register with a court, so a ministry, an
   * urząd or a wojewódzki fundusz has no `krsNumber` at all. REGON and `nip`
   * are what is left to name one by - see `shared/identifiers.ts`. */
  regonNumber?: string;
  /** NIP, the tax identifier: ten digits. The other identifier an institution
   * outside KRS still has. */
  nipNumber?: string;
  // TODO populate this field
  location?: string;
  /** PKD codes from KRS, e.g. "86.10.Z" */
  activity?: string[];
  /** Which sectors the company is filed under, e.g. `["koleje"]`.
   *
   * What the category filter on /eksploruj matches with `array-contains`, and
   * a node field like any other: revisioned, and editable from the page. The
   * pipelines work a default out from the KRS entry - see
   * `data/pipelines/src/entities/company_categories.py` - and the site names
   * them in `shared/companyCategories.ts`.
   *
   * Empty and absent differ. Empty is an answer: the company belongs to no
   * sector the site tracks. Absent means nobody has decided, which is the case
   * for every company the pipelines have not reached since this became a
   * field of its own. */
  categories?: string[];
  /** Where `categories` came from, so an ingest does not overwrite a human.
   *
   * Absent means the pipelines wrote it, which is the case for every value
   * predating the edit form. Set by `/api/revisions/create` whenever a
   * proposal states the field, exactly as `isPublicSource` is. */
  categoriesSource?: "manual";
  /** Legal form, as `dzial1.danePodmiotu.formaPrawna` spells it, e.g.
   * "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ" or "SPÓŁKA Z OGRANICZONĄ
   * ODPOWIEDZIALNOŚCIĄ".
   *
   * Stored raw, for the same reason `activity` is: what it implies about a
   * place is a decision the site makes and can revisit, not one the scrapers
   * should have to restate. It is what the pipelines already categorise on -
   * see `entities/company_categories.py`, where it is the only signal an SPZOZ
   * carries, the associations register having no PKD codes at all - and it is
   * what /eksploruj/szpitale shows beside a hospital's board, because it is the
   * difference between one run as a spółka and one run as an SPZOZ.
   *
   * Held on the node for display only. What follows from it about pay is
   * `supervisoryBody`, worked out by the pipelines; nothing on the site reads
   * this string and decides. */
  legalForm?: string;
  /** Which organ supervises the place, as `dzial2.organNadzoru[].nazwa` names
   * it, normalized by `data/pipelines/src/scrapers/krs/organs.py`.
   *
   * Reporting, not a rule - and the difference from `supervisoryBody` above is
   * the whole reason both exist. That one reads the *legal form*, so it has an
   * answer for every institution and is what the employment counters exclude
   * an unpaid seat by. This one reads what the entry actually filed, which is
   * finer - it can tell a komisja rewizyjna from a rada fundacji - but is
   * absent for 719 of the 1,192 SPZOZ in the crawl, whose rada społeczna is
   * created by statute and never registered. So `"brak"` is emphatically not
   * evidence of a paid board, and only /eksploruj/szpitale reads this field.
   *
   * A scalar rather than a list: no crawled entry anywhere names both a rada
   * nadzorcza and a rada społeczna, barely any name two organs at all, and a
   * scalar is the only shape Firestore can filter on - a stored array comes
   * back as a numbered-key object, see `asArray` in server/utils/nodeFilters.
   *
   * Absent means the scrapers have not looked at this company since the field
   * was added, which is not the same as `"brak"`. */
  supervisoryOrgan?: SupervisoryOrgan;
  /** Whether the place is owned or run by the public sector.
   *
   * Only `true` is an assertion. `false` and absent both mean *not confirmed*,
   * and are not evidence of private ownership - see `publicSectorKnown`.
   *
   * The scrapers set it from KRS: a supervising ministry
   * (`organPodmiotZalozycielskiMinisterNadzorujacy`), a shareholder that is a
   * gmina/powiat/województwo/Skarb Państwa, or a hardcoded list of state-owned
   * companies, then propagated down ownership chains so subsidiaries inherit it.
   *
   * Note this is *not* "publicly traded" — see `data/pipelines/src/scrapers/krs/list.py`.
   */
  isPublic?: boolean;
  /** Where `isPublic` came from, so an ingest does not overwrite a human.
   *
   * Absent means the scrapers wrote it, which is the case for every value
   * predating the edit form. */
  isPublicSource?: "manual";
  /** What this institution's supervisory organ is called, e.g.
   * `"rada-spoleczna"`.
   *
   * Absent is the ordinary case and means "nothing special to say": either the
   * pipelines have not read the register's `formaPrawna` for this company, or
   * they have and it is one whose organ is the rada nadzorcza every stored
   * supervisory edge already claims. Only a value present here changes how the
   * site reads those edges - see `shared/companyBodies.ts` for what each one
   * means and `computeEdgeStats` for what it does.
   *
   * Worked out by the pipelines in
   * `data/pipelines/src/entities/company_bodies.py`, because the answer comes
   * from `formaPrawna`, which never reaches the node. Not editable from the
   * page and so with no `...Source` marker of its own: `categories` and
   * `isPublic` have one because a person can know what the register cannot
   * show, and here the register is the answer. */
  supervisoryBody?: string;
}

/** Whether anything is actually known about a place's ownership.
 *
 * KRS does not publish the shareholders of a spółka akcyjna unless there is
 * exactly one, so for most joint-stock companies the scrapers have no signal at
 * all and store `false` - Małopolska Agencja Rozwoju Regionalnego, owned in
 * majority by Województwo Małopolskie, among them. Institutions that are not in
 * KRS at all (ministries, urzędy, wojewódzkie fundusze) have no value either.
 *
 * So `false` is only worth showing as "private" once a human has said so; until
 * then the honest answer is that we do not know. */
export function publicSectorKnown(company: {
  isPublic?: boolean;
  isPublicSource?: "manual";
}): boolean {
  return company.isPublic === true || company.isPublicSource === "manual";
}

export interface Article extends Omit<Node, "type"> {
  type: "article";
  sourceURL: string;
  shortName?: string;
  publishedDate?: Timestamp;

  // TODO add shape to this field
  /** Field containing data from script[type="application/ld+json"] */
  meta?: unknown;
}

export interface Region extends Omit<Node, "type"> {
  type: "region";
  teryt: string;
}

/** A story several articles belong to — "powodzianie KRR", say.
 *
 * Nothing to do with `ExtractionFact.tag` or `ArticleCapture.extraction.tag`,
 * which name the model that produced a fact. This is editorial: which affair an
 * article is about.
 *
 * A topic is a node, and an article is joined to it by a `tagged` edge, so that
 * tagging inherits the review flow every other relation has - one document per
 * tag, approved on its own, live but `published: false` until then. Holding the
 * same thing in a `tags` array on the article would have put every tag inside
 * the article's whole-document revision, where approving one reverts whatever
 * else was proposed in a competing snapshot.
 */
export interface Topic extends Omit<Node, "type"> {
  type: "topic";
  description?: string;
}

export interface NodeTypeMap {
  person: Person;
  place: Company;
  article: Article;
  record: never;
  region: Region;
  topic: Topic;
}

/** Where a revision stands with whoever reviews it.
 *
 * Absent means the same as `pending`: every revision written before review
 * existed is waiting, whether it came from a person or from the pipeline. Only
 * an approved revision can be the one a node points at, and a rejected one is
 * kept rather than deleted so the same suggestion is not re-reviewed forever.
 */
export type RevisionStatus = "pending" | "approved" | "rejected";

/** Which collection a revision's target lives in.
 *
 * Revisions carry `node_id` whatever they describe, so an edge revision is not
 * tellable from a node revision by its id alone. Written on new revisions;
 * `revisionCollection` infers it for the ones stored before this existed.
 */
export type RevisionCollection = "nodes" | "edges";

export interface Revision {
  id?: string;
  nodeId?: string;
  node_id?: string;
  data: Node | Edge | Record<string, unknown>;
  revision_id?: string | { path: string } | unknown;
  update_time: string | unknown; // ISO string
  update_user: string;
  update_automatic?: boolean;
  collection?: RevisionCollection;
  status?: RevisionStatus;
  /** Why a revision was turned down, so the author can be told something more
   * useful than "no". */
  reject_reason?: string;
  review_user?: string;
  review_time?: string | unknown;
}

/** The collection a revision's target document lives in.
 *
 * Only an edge carries both ends of a link, and no node ever does, so the
 * shape of the data answers this for the revisions written before the
 * `collection` field existed.
 */
export function revisionCollection(revision: {
  collection?: unknown;
  data?: unknown;
}): RevisionCollection {
  if (revision.collection === "edges" || revision.collection === "nodes") {
    return revision.collection;
  }
  const data = revision.data as
    { source?: unknown; target?: unknown } | undefined | null;
  return data && data.source && data.target ? "edges" : "nodes";
}

/** Whether a revision is still waiting for someone to look at it. */
export function revisionIsPending(revision: { status?: unknown }): boolean {
  return revision.status !== "approved" && revision.status !== "rejected";
}

/** The bare id of the revision a document points at, or undefined.
 *
 * `revision_id` reaches callers in three shapes depending on how far it has
 * travelled: a `DocumentReference` straight from firebase-admin, the `{ path }`
 * it serialises to over SSR, or a path string a previous hop already flattened.
 * All three end in the id, which is the only part worth comparing.
 */
export function approvedRevisionId(revisionId: unknown): string | undefined {
  if (!revisionId) return undefined;

  let path: string | undefined;
  if (typeof revisionId === "string") {
    path = revisionId;
  } else if (typeof revisionId === "object") {
    const asPath = revisionId as { path?: unknown; id?: unknown };
    if (typeof asPath.path === "string") path = asPath.path;
    else if (typeof asPath.id === "string") return asPath.id;
  }
  if (!path) return undefined;

  const segments = path.split("/");
  return segments[segments.length - 1] || undefined;
}

export interface Link<T extends NodeType> {
  type: T;
  id: string;
  name: string;
}

export interface Comment {
  id: string;
  content: string;
  authorId: string;
  authorName?: string; // Currently not strictly enforced, might rely on user fetching
  createdAt: string; // ISO string

  isLead: boolean; // True if no nodeId, edgeId, parentId
  nodeId?: string; // Optional: attached to a node (Person, Company, Article)
  edgeId?: string; // Optional: attached to an edge
  parentId?: string; // Optional: reply to another comment
}

export type NoteAdminStatus = "resolved" | "unresolved";

/** What the user meant by an entry: a source they read, a correction they want
 * made, or data they noticed is absent. Missing means "source" — every entry
 * written before kinds existed was one.
 */
export type NoteEntryKind = "source" | "change_request" | "missing";

export type NoteSource = {
  /** Only a "source" entry needs one; a correction may stand on its own. */
  url?: string;
  note: string;
  kind?: NoteEntryKind;

  /** The article node this url was promoted to, once it has been.
   *
   * Every source somebody adds to a note becomes an article, so that a url
   * worth reading is in the list of them rather than only inside one person's
   * note. Set after the note is stored, and what tells a later save that this
   * entry has already been through it. */
  articleNodeId?: string;

  // Admin triage of an individual source. Each source is reviewed separately.
  adminStatus?: NoteAdminStatus;
  adminType?: string;
  /** Set when a reviewer looked at the entry and could not tell its type from
   * the note and its url alone - it needs the node beside it, which only the
   * table view has room for. Keeps the entry out of the phone queue without
   * pretending it has been classified; cleared as soon as a type is given. */
  adminTypeDeferred?: boolean;
};

/** Entries written before kinds existed are all sources.
 *
 * Here rather than in `composables/notes.ts`, where it used to live, so that
 * `utils/notePromotion.ts` can read a kind without importing the composable -
 * which now reads the promotion helpers back, and the two would form a cycle.
 */
export function noteKindOf(source: Pick<NoteSource, "kind">): NoteEntryKind {
  return source.kind ?? "source";
}

/** Whether an entry is still waiting on an admin, which is what the dashboard
 * counts under "Notatki wymagające działania".
 *
 * Two ways in. A reviewer can flag any entry "Nierozwiązane" by hand, and a
 * correction ("Do poprawy") or a gap somebody reported ("Brakuje danych") is
 * one the moment it is written - its author is saying the data is wrong or
 * absent, so it needs acting on before anybody has triaged it. A source is
 * not: it is something to read, and only a reviewer can say it is more.
 *
 * Either way it is the reviewer marking it "Rozwiązane" that takes it off the
 * list; an explicit status always wins over the kind.
 */
export function noteNeedsAction(entry: {
  kind?: NoteEntryKind | null;
  adminStatus?: NoteAdminStatus | null;
}): boolean {
  if (entry.adminStatus) return entry.adminStatus === "unresolved";
  return (entry.kind ?? "source") !== "source";
}

/** Note allows users to collaborate on a node content without accessing the node itself.
 * A node can have multiple notes but one per user.
 * User can view/edit their own note and admins can view all notes.
 */
export type Note = {
  userUid: string;
  nodeId: string;

  /** When the note was first written, as an ISO string once it has been read
   * back. Written once and never rewritten, so it is the date a reader can
   * always be shown - `updatedAt` only exists once the author has come back to
   * the note. Backfilled onto older notes from the document's creation time by
   * scripts/migrate/backfill-note-timestamps.ts. */
  createdAt?: string;

  /** When the author last saved the note. Admin triage deliberately leaves it
   * alone, so a review queue stays ordered by when people wrote rather than by
   * when it was reviewed. Absent until the author edits a note they already
   * wrote. */
  updatedAt?: string;

  // Users can easily add sources they encounter and annotate what they found interesting in them.
  sources?: NoteSource[];
};

/** One reviewable entry - a single source inside a note, joined with the node
 * it hangs off and flattened out of the array it is stored in. Admins triage
 * each of these separately, so it is the unit a review queue lists. */
export type NoteRow = {
  /** Stable identity of the entry, which is what a table keys rows on. */
  key: string;
  noteId: string;
  sourceIndex: number;
  nodeId: string;
  nodeName: string | null;
  nodeType: NodeType | null;
  userUid: string;
  /** When the note was written. The date a reviewer is shown, and what the
   * queue is ordered by, because it is the one that stands still. */
  createdAt: string | null;
  /** When the author last came back to it, if they ever did. Null on a note
   * nobody has edited since writing - deliberately not filled in from
   * `createdAt`, so the two stay tellable apart. */
  updatedAt: string | null;
  note: string;
  url: string | null;
  kind: NoteEntryKind;
  /** The article node this entry's url became, once it has. Carried so a
   * reviewer can reach the page it made, and so an entry that was never
   * promoted - everything written before the feature, and everything whose
   * promotion failed - is tellable from one that was. */
  articleNodeId: string | null;
  adminStatus: NoteAdminStatus | null;
  adminType: string | null;
  /** Whether classifying this entry was handed back to the table view. */
  adminTypeDeferred: boolean;
};

export type FeedbackKind = "bug" | "idea" | "data" | "other";

/** Kept here rather than with the rest of the UI copy in
 * `app/composables/feedback.ts`, because the Slack trigger needs the same
 * labels and Cloud Functions cannot import from `app/`. */
export const feedbackKindLabels: Record<FeedbackKind, string> = {
  bug: "Coś nie działa",
  data: "Błędne dane",
  idea: "Pomysł",
  other: "Coś innego",
};

export type FeedbackStatus = "new" | "in_progress" | "resolved" | "wont_fix";

/** How far the Slack forward got. Absent on documents written before
 * forwarding existed, and on any that the trigger has not reached yet. */
export type FeedbackSlackState = {
  state: "sending" | "sent" | "failed";
  /** Slack's message id. A string, always — parsing it as a number loses
   * precision and breaks any later chat.update. */
  ts?: string;
  channel?: string;
  /** Bounded so a permanently broken forward cannot ride out Eventarc's whole
   * retry window. */
  attempts?: number;
  error?: string;
};

/** A report written while working through one entry of the QA changelog
 * (`shared/qa.ts`), rather than from the "Zgłoś" button.
 *
 * A verdict on a changelog entry is feedback like any other - the same
 * endpoint, the same Slack channel, the same admin queue - it just also knows
 * which entry was being checked and what the checker concluded. The reader's
 * own verdict still lives in `qaChecks`, because that is per person and drives
 * what /qa shows them; this is the copy that reaches the team.
 */
export type FeedbackQaContext = {
  /** `QaItem.id`. Ids are never renamed or reused, so an old report still
   * points at the entry it was written about. */
  itemId: string;
  /** The entry's title as it read at the time. Copied rather than looked up,
   * so a card in Slack still makes sense after the entry is edited - and so
   * the Cloud Function does not need the changelog compiled into it. */
  title: string;
  status: QaCheckStatus;
};

/** What the reporter was looking at when they hit the feedback button, so a
 * report arrives already tied to the page it is about. */
export type FeedbackContext = {
  route: string;
  nodeId?: string;
  /** The document title as it stood, captured rather than resolved later so a
   * report reads the way the page did. */
  pageTitle?: string;
  userAgent?: string;
  viewport?: { width: number; height: number };
  /** Set only for reports written on /qa - see `FeedbackQaContext`. */
  qa?: FeedbackQaContext;
};

export type Feedback = {
  id?: string;
  kind: FeedbackKind;
  message: string;
  /** Absent when the reporter was not signed in. Anonymous reports are allowed
   * on purpose — the point is to lower the bar for telling us something. */
  userUid?: string;
  /** Volunteered by the reporter so we can reply. Never required. */
  contact?: string;
  context: FeedbackContext;
  createdAt: string;
  adminStatus: FeedbackStatus;
  adminNote?: string;
  slack?: FeedbackSlackState;
};

export type ExtractionFactType =
  | "employment"
  | "party_membership"
  | "personal_relation"
  | "affair_involvement";

export interface ExtractionFact {
  id?: string;
  url: string;
  justification: string;
  justification_in_text?: string | null;
  fact_type: ExtractionFactType;
  // Fields vary by fact_type:
  person?: string;
  organization?: string;
  role?: string;
  party?: string;
  subject?: string;
  object?: string;
  relation?: string;
  affair?: string;
  // Metadata:
  articleUrl: string;
  articleDomain?: string;
  articleNodeId?: string; // linked node if URL matches an existing article node
  /** The person node this fact's subject was matched to, when the pipeline
   * confirmed that person is named in the article (`koryta_ids`) and the name
   * on the fact is theirs. Resolved once at ingest, so reading a fact never
   * costs a node lookup. Absent means nobody in the graph was matched - not
   * that the person is unknown to it. */
  personNodeId?: string;
  /** The matched node's own spelling of the name, which is what its url slug is
   * built from. Stored beside the id so a card can link without a read; the
   * fact's own `person` is how the article spelled it, and the two differ. */
  personNodeName?: string;
  tag: string; // extraction model tag (e.g. "v1_qwen3-32b")
  createdAt?: string;
  uploaderUid?: string;
  /** Vote aggregate, maintained by the `onVoteWritten` trigger exactly as it
   * is for nodes. Seeded at ingest so that never-voted facts still carry the
   * field — Firestore cannot query for one that is absent, and the review flow
   * needs to ask for the unreviewed ones. */
  stats?: { votes: NodeStats["votes"] };
  /** Convenience flag derived from `stats.votes.humanVoted` by
   * /api/extractions: a human (not the pipeline) has reviewed this fact, so the
   * review flow hands it to no one else. */
  reviewed?: boolean;
}
