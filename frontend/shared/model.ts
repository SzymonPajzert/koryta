import type { Timestamp } from "firebase-admin/firestore";

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
  targetNodeIds: string[];
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
  "interesting" | "quality" | "correct" | "insufficient";

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

  /** The aid programme an `aid` edge rolls up, as SUDOP numbers it
   * ("SA.116730"). Part of what the edge asserts - one institution can pay a
   * company under two unrelated programmes - so it discriminates the document
   * id, see `EDGE_SEMANTICS` in server/utils/edges.ts. */
  aidMeasure?: string;
  /** Ekwiwalent dotacji brutto, in złoty, summed over every decision the edge
   * rolls up.
   *
   * The gross grant equivalent and not the nominal value, because the nominal
   * value of an odroczenie składki is the whole deferred contribution while the
   * benefit is only the interest nobody paid. Mixing the two in one ranking
   * puts whoever deferred the most at the top, which is not who got the most.
   */
  aidGross?: number;
  /** How many SUDOP decisions the edge rolls up. A count, not a list: the
   * decisions themselves are not nodes, and eight of them are eight rows of one
   * report rather than eight facts about the pair.
   *
   * Emphatically not a signal. The published analyses of this data flag a
   * beneficiary at eight or more, and measured over the register those 71
   * beneficiaries hold 9.78% of the money while the 1340 with a single decision
   * hold 9.72% - the same pot. See `scrapers/sudop/signals.py`. */
  aidDecisions?: number;
  /** The nominal value the edge rolls up, alongside `aidGross`. For a dotacja
   * they are equal; for a deferral the nominal value is the whole deferred
   * contribution and the gross equivalent is only the unpaid interest. */
  aidNominal?: number;
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

export function nodeIcon(type: NodeType) {
  switch (type) {
    case "person":
      return "mdi-account-outline";
    case "place":
      return "mdi-office-building-outline";
    case "article":
      return "mdi-file-document-outline";
    case "topic":
      return "mdi-tag-outline";
    default:
      return "mdi-comment-arrow-right-outline";
  }
}

export type EdgeType =
  | "employed"
  | "connection"
  | "mentions"
  | "owns"
  | "comment"
  | "election"
  | "tagged"
  | "aid";

export const nodeTypeIcon: Record<NodeType, string> = {
  person: "mdi-account-outline",
  place: "mdi-office-building-outline",
  article: "mdi-file-document-outline",
  region: "mdi-map-marker-radius-outline",
  topic: "mdi-tag-outline",
};

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
  /** Categories derived from PKD codes, see shared/companyCategories.ts */
  categories?: string[];
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
   * Note this is *not* "publicly traded" — see `data/scrapers/src/scrapers/krs/list.py`.
   */
  isPublic?: boolean;
  /** Where `isPublic` came from, so an ingest does not overwrite a human.
   *
   * Absent means the scrapers wrote it, which is the case for every value
   * predating the edit form. */
  isPublicSource?: "manual";
  /** Structural signals the public-aid pipeline raised about this beneficiary:
   * `non_sme`, `outside_flood_region`, `capped_decision`, `rare_grantor`,
   * `asset_light`. Derived, like `categories`, and rewritten wholesale by each
   * ingest rather than accumulated.
   *
   * None of them is an accusation and none of them counts decisions - see
   * `scrapers/sudop/signals.py`, which has the measurements showing why a count
   * of decisions is the wrong question. Every one has an ordinary explanation
   * available; they mark a beneficiary as worth reading, not as irregular. */
  aidSignals?: string[];
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
  // TODO enable users associating with a source node.
  // source_id: string;

  // Admin triage of an individual source. Each source is reviewed separately.
  adminStatus?: NoteAdminStatus;
  adminType?: string;
  /** Set when a reviewer looked at the entry and could not tell its type from
   * the note and its url alone - it needs the node beside it, which only the
   * table view has room for. Keeps the entry out of the phone queue without
   * pretending it has been classified; cleared as soon as a type is given. */
  adminTypeDeferred?: boolean;
};

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
  adminStatus: NoteAdminStatus | null;
  adminType: string | null;
  /** Whether classifying this entry was handed back to the table view. */
  adminTypeDeferred: boolean;
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
