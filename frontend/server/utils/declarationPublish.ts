/**
 * What a settled reading of a BIP asset declaration does to the pages it is
 * for.
 *
 * Once readers agree on the birth date a crop shows (`recordAnswer`), or the
 * job read a typed one with high confidence at upload, the reading meets the
 * pages for the first time - nothing on the BIP side ever carries a date the
 * site knows. Each page the crop's candidacies name is one of:
 *
 * - without a birth date: recorded, nothing else. The pipeline's join proposes
 *   one from the register where the two agree; that is a reviewer's call.
 * - born on another day: flagged with a note on the page. Nothing is detached
 *   or changed - which of the two is wrong is for a person to say.
 * - born that day and public already: the declaration is linked on it.
 * - born that day and a draft: queued, and published by the site itself, a
 *   few a Warsaw day, with its KRS jobs and the candidacies the declaration
 *   was filed for. Two pages born that day are both held: one of them is the
 *   person, and the reading cannot say which.
 *
 * A date an admin settled on /admin/oswiadczenia (`decideExtract`) meets the
 * pages the same way, but a draft born that day is held (`admin_decision`)
 * and a public one is left as it is: the admin chose the date with the
 * pages' dates a click away, so it confirms nothing. It is linked on no page
 * and publishes none, the default until it is decided whether an admin's
 * date may (task decide-admin-settled-date-publication).
 *
 * What a public page shows is read off the crops when it is asked for
 * (`confirmedDeclarations`), not off the record: the record keeps what
 * matched when it was written, and the page's date, or the crop's, can
 * change after that.
 *
 * Publishing re-reads everything and holds the page rather than overrule
 * anybody (`publishPage`). The daily limit lives in the runtime config and is
 * 0 until it is set, so as shipped the site queues pages and publishes
 * none of them on its own. An admin can publish the queue from
 * /admin/oswiadczenia past the limit, at 0 too (`drainPublications` with
 * `pressedBy`), through the same checks. Nothing is published while a people
 * import may be writing pages, and a page a stale write of one took off the
 * site again is found and put back (`restoreReverted`).
 */
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { AuditEntry } from "~~/shared/audit";
import { isoDay, warsawDate, warsawHour } from "~~/shared/dates";
import {
  DECLARATION_ACTOR,
  nameFitsPage,
  PEOPLE_IMPORT_WINDOW,
  type DrainResult,
  type LocalOffice,
  type PageMatch,
  type PageOutcome,
  type PublicationEdgeHold,
  type PublicationHoldReason,
  type PublicationStatus,
  type SweepResult,
} from "~~/shared/declarations";
import { candidacyElection } from "~~/shared/electionDays";
import { registerEntry } from "~~/shared/identifiers";
import { CONTENT_CHANGED_AT } from "~~/shared/lastmod";
import type { Edge, Note, NoteSource, Revision } from "~~/shared/model";
import { approvedRevisionId, pageIsPublic } from "~~/shared/model";
import {
  latestPublishableRevision,
  normalizeUpdateTime,
} from "~~/shared/revisions";
import { isAutomatedUid } from "~~/shared/stats";
import { placeClashes } from "~~/shared/twoPlaces";
import { recordAudit } from "./audit";
import {
  EXTRACTS,
  finishClaims,
  PUBLICATIONS,
  PUBLISH_LIMITS,
  READER_FINDS,
  unitOf,
} from "./declarations";
import {
  approveWaitingEdge,
  cascadeUnpublishEdges,
  EDGE_PUBLISH_CHUNK,
  edgeRevisionsForMany,
  publishEdgeInBatch,
  settledEdgeRefusal,
  waitingEdgeRefusal,
} from "./edgePublication";
import { unnamedLocal } from "./edges";
import { peopleImportRunning } from "./jobs";
import { resolveMergedNode } from "./merge";
import { applyRevision, holdsRevision, nodeRevisions } from "./revisions";

/** How long a page may stay `publishing` before the next pass takes it up
 * again. Publishing one takes seconds; longer means the pass that claimed it
 * died with it. */
export const STUCK_PUBLISHING_MS = 15 * 60_000;

/** Pages one pass over the queue takes up at most, so the request that runs
 * it stays a request. The next pass carries on. */
export const DRAIN_BATCH = 25;

/** Settled crops one sweep compares with their pages, of each kind. */
export const SWEEP_BATCH = 50;

/** How far back a sweep looks for pages this automation published that are
 * drafts again. The import's stale write lands seconds after the publication
 * it undoes, so a few days is plenty, and the sweep runs after every upload. */
export const REVERT_WINDOW_DAYS = 3;

/** Crops naming one page that publishing it reads, looking for a reading of
 * another birth date. A person has a declaration a year per office. */
const READINGS_PER_PAGE = 50;

const actor = { uid: DECLARATION_ACTOR };

/** A declaration as a page links it. */
export type LinkedDeclaration = {
  url: string;
  year: number | null;
  unit: string;
  office: LocalOffice | null;
};

/** What `declarationPublications/<page id>` holds. Never a date: the page has
 * its own, and the reading is on the crop. */
export type StoredPublication = {
  personId: string;
  status: PublicationStatus;
  reason: PublicationHoldReason | null;
  /** The settled crops whose date the page has. */
  extractIds: string[];
  declarations: LinkedDeclaration[];
  queuedAt?: Timestamp;
  /** When a pass took the page up, and the Warsaw day of the slot it took.
   * No day where an admin's press took it up: a press takes no slot. */
  claimedAt?: Timestamp;
  day?: string;
  heldAt?: Timestamp;
  publishedAt?: Timestamp;
  /** Whether the site published the page on its own: false where an admin
   * pressed for it. */
  autoPublished?: boolean;
  /** The uid of the admin whose press of „Opublikuj z kolejki” took the page
   * up last (`drainPublications`); none where the automation did. */
  pressedBy?: string;
  /** The import's revision approved on the way up, where the page had none. */
  approvedRevision?: string | null;
  edges?: {
    published: string[];
    held: { id: string; reason: PublicationEdgeHold }[];
  };
  /** When a sweep found the page a draft again after this automation had put
   * it up, and nobody on record had taken it down. */
  revertedAt?: Timestamp;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

/** What `matchPages` concluded about one crop. */
export type MatchResult = {
  extractId: string;
  /** Null when the crop is not a settled full date, which compares with
   * nothing. */
  pageMatch: PageMatch | null;
  outcomes: Record<string, PageOutcome>;
  /** Whether anything was written. */
  changed: boolean;
};

/** What `publishPage` did. `confirmed` is a page somebody else made public
 * while it waited: nothing was published, and the day's slot is not used. */
export type PublishOutcome =
  | {
      status: "published";
      approvedRevision: string | null;
      edges: NonNullable<StoredPublication["edges"]>;
    }
  | { status: "held"; reason: PublicationHoldReason }
  | { status: "confirmed" };

/** A pass's hold on one page: the Warsaw day of the slot it went up under -
 * null for a press, which takes none - and the `claimedAt` this pass wrote,
 * which tells it whether the page is still its own when it comes to give the
 * slot back. */
type Claim = { day: string | null; claimedAt: Timestamp };

type StoredRevision = Revision & { id: string };

/** Whether `now` falls in `PEOPLE_IMPORT_WINDOW`. */
export function inPeopleImportWindow(now: Date): boolean {
  const hour = warsawHour(now);
  return hour >= PEOPLE_IMPORT_WINDOW.from && hour < PEOPLE_IMPORT_WINDOW.to;
}

/** Whether a people import may be writing pages now, as far as the runs it
 * reports say. A question that cannot be answered counts as yes: publishing a
 * page an hour late costs nothing, and one a stale write makes a draft again
 * leaves its relations live on a page nobody can open. */
async function peopleImportBusy(now: Date): Promise<boolean> {
  try {
    return await peopleImportRunning(now);
  } catch (error) {
    console.error(
      "[declarations] cannot tell whether a people import is running; " +
        "publishing nothing",
      error,
    );
    return true;
  }
}

// ---------------------------------------------------------------------------
// Comparing a settled reading with its pages
// ---------------------------------------------------------------------------

/**
 * Compares the date readers agreed on with each page the crop is for, and
 * acts on what it finds (see the top of this file).
 *
 * Idempotent: a second run over the same state writes nothing. The note is
 * filed once per crop and page, a declaration is linked once, and the crop is
 * written only when what it says about its pages changes. That is what lets
 * every caller - the answer that settled the crop, the upload of a crop that
 * came settled, the sweep - call it without asking whether another did.
 *
 * A crop that left any page undated or born on another day is marked to be
 * compared again (`pageRecheck`): the import may bring the undated page a
 * date, and a reviewer may correct the other one, and either can make the
 * crop a match - or a second page with its date, which holds both.
 *
 * A date an admin settled holds every draft born that day, for somebody to
 * publish by hand (`admin_decision`), and joins no record that readers or
 * the job made (`nextPublication`). A public page born that day gets no
 * record at all: it is up already, the admin's date links nothing on it, and
 * a hold would sit on the admin's list of held pages asking for nothing. A
 * page born on another day is flagged as for any reading.
 */
export async function matchPages(
  db: Firestore,
  extractId: string,
  now: Date = new Date(),
): Promise<MatchResult> {
  const extractRef = db.collection(EXTRACTS).doc(extractId);
  const extract = (await extractRef.get()).data();
  const agreed = agreedDay(extract);
  if (!extract || !agreed) {
    return { extractId, pageMatch: null, outcomes: {}, changed: false };
  }

  const byAdmin = settledByAdmin(extract);
  const pages = await livePages(db, asStrings(extract.personIds));
  const outcomes: Record<string, PageOutcome> = {};
  const born: LivePage[] = [];
  for (const page of pages) {
    const stored = birthDateOf(page.data);
    if (!stored) outcomes[page.id] = "no_date";
    else if (stored !== agreed) outcomes[page.id] = "different";
    else born.push(page);
  }
  for (const page of born) {
    outcomes[page.id] =
      byAdmin || born.length > 1
        ? "held"
        : pageIsPublic(page.data)
          ? "confirmed"
          : "queued";
  }

  const declaration = declarationOf(extract);
  let changed = false;
  for (const page of pages) {
    const outcome = outcomes[page.id]!;
    if (outcome === "no_date") continue;
    if (outcome === "held" && byAdmin && pageIsPublic(page.data)) continue;
    const wrote =
      outcome === "different"
        ? await flagAnotherDate(db, page.id, extractId, extract, now)
        : await recordPublication(db, page.id, {
            outcome,
            byAdmin,
            extractId,
            declaration,
            now,
          });
    changed = wrote || changed;
  }

  const pageMatch: PageMatch =
    born.length > 0
      ? "same"
      : Object.values(outcomes).includes("different")
        ? "different"
        : "no_date";
  const pageRecheck = Object.values(outcomes).some(
    (outcome) => outcome === "no_date" || outcome === "different",
  );
  if (
    extract.pageMatch !== pageMatch ||
    extract.pageRecheck !== pageRecheck ||
    !sameOutcomes(extract.pageOutcomes, outcomes)
  ) {
    await extractRef.update({
      pageMatch,
      pageOutcomes: outcomes,
      pageRecheck,
      pageCheckedAt: Timestamp.fromDate(now),
    });
    changed = true;
  }
  return { extractId, pageMatch, outcomes, changed };
}

/** The settled full date of a crop, or null: a crop still read, read as a
 * year alone, unreadable or withdrawn compares with nothing. */
function agreedDay(extract: DocumentData | undefined): string | null {
  if (extract?.status !== "agreed") return null;
  const agreed = extract.agreed as { value?: unknown; kind?: unknown } | null;
  if (agreed?.kind !== "date" || typeof agreed.value !== "string") return null;
  return isoDay(agreed.value) ? agreed.value : null;
}

/**
 * Credits a reader with the people a date they typed found, as the answer is
 * saved: each live page of the crop whose birth date the date does not
 * contradict. A page without a birth date has nothing to contradict, and a
 * year alone is held to the year. The reward is for the reading, so it comes
 * at once, before anybody else has read the crop and whether or not the
 * person is ever published. One record a reader and a person, so a person
 * read twice is found once; the reader's „Znaleziono” counts them
 * (`queueFor`). A reader without an account is credited under the browser's
 * id and keeps it when they sign in (`claimAnswers`). Returns how many people
 * the date found.
 */
export async function creditFinds(
  db: Firestore,
  find: {
    uid: string;
    extractId: string;
    personIds: readonly string[];
    /** `YYYY-MM-DD` or `YYYY`, as `parseTypedDate` reads the typing. */
    value: string;
  },
  now: Date = new Date(),
): Promise<number> {
  const found = (await livePages(db, find.personIds)).filter(
    (page) => !contradicts(find.value, birthDateOf(page.data)),
  );
  if (found.length === 0) return 0;
  const at = Timestamp.fromDate(now);
  const batch = db.batch();
  for (const page of found) {
    batch.set(
      db.collection(READER_FINDS).doc(`${find.uid}_${page.id}`),
      { uid: find.uid, personId: page.id, extractId: find.extractId, at },
      { merge: true },
    );
  }
  await batch.commit();
  return found.length;
}

/** Whether a typed date says the person was born on another day than the
 * page's stored `YYYY-MM-DD`: a year alone is compared with the year, and a
 * page without a date contradicts nothing. */
function contradicts(typed: string, stored: string): boolean {
  if (!stored) return false;
  const length = Math.min(typed.length, stored.length);
  return typed.slice(0, length) !== stored.slice(0, length);
}

/** Whether the crop's date is one an admin settled (`decideExtract`), rather
 * than one readers agreed on without seeing the page's or the job read off a
 * typed form at upload. */
function settledByAdmin(extract: DocumentData | undefined): boolean {
  return (
    (extract?.agreed as { by?: unknown } | null | undefined)?.by === "admin"
  );
}

/** The page's birth date as stored, "" for none. Compared as written, the way
 * both its writers - the import and the edit form - write it. */
function birthDateOf(data: DocumentData | undefined): string {
  const value = data?.birthDate;
  return typeof value === "string" ? value.trim() : "";
}

type LivePage = { id: string; data: DocumentData };

/** The live person pages the ids name, each once, followed through merges:
 * a page merged since the crop was uploaded is compared as the page it went
 * into, and one that is gone, removed or not a person is not compared. */
async function livePages(
  db: Firestore,
  ids: readonly string[],
): Promise<LivePage[]> {
  const pages = new Map<string, LivePage>();
  for (const id of unique(ids)) {
    const { snapshot } = await resolveMergedNode(db, id);
    const data = snapshot?.data();
    if (!snapshot || data?.type !== "person" || data.deleted === true) {
      continue;
    }
    pages.set(snapshot.id, { id: snapshot.id, data });
  }
  return [...pages.values()];
}

function declarationOf(extract: DocumentData): LinkedDeclaration {
  return {
    url: typeof extract.url === "string" ? extract.url : "",
    year:
      typeof extract.declarationYear === "number"
        ? extract.declarationYear
        : null,
    ...unitOf(extract),
  };
}

/** Files the note that says the page's birth date is not the one read off
 * the declaration: one entry per crop, in the note the automation keeps on
 * the page (`<page>_<actor>`, where the rules put anybody's note on a person).
 *
 * A correction, so the admin dashboard counts it as waiting on somebody
 * (`noteNeedsAction`). It names the declaration and links it, and says
 * neither date: the page shows its own to whoever may see the page, and the
 * readers' one stays with the crop, where an admin compares the two. A note
 * on a person is read by any signed-in reader, and the readers of the
 * person's other crops are among them.
 */
async function flagAnotherDate(
  db: Firestore,
  pageId: string,
  extractId: string,
  extract: DocumentData,
  now: Date,
): Promise<boolean> {
  const ref = db.collection("notes").doc(`${pageId}_${DECLARATION_ACTOR}`);
  return db.runTransaction(async (tx) => {
    const note = (await tx.get(ref)).data() as Note | undefined;
    const sources = note?.sources ?? [];
    if (sources.some((entry) => entry.declarationExtractId === extractId)) {
      return false;
    }
    const url = typeof extract.url === "string" ? extract.url : "";
    const entry: NoteSource = {
      kind: "change_request",
      ...(url ? { url } : {}),
      note: anotherDateNote(extract),
      declarationExtractId: extractId,
    };
    const at = Timestamp.fromDate(now);
    tx.set(
      ref,
      {
        userUid: DECLARATION_ACTOR,
        nodeId: pageId,
        sources: [...sources, entry],
        // `createdAt` once, `updatedAt` whenever the author comes back, as
        // `saveNote` keeps them.
        ...(note ? { updatedAt: at } : { createdAt: at }),
      },
      { merge: true },
    );
    return true;
  });
}

/** The note's text: plain words, the declaration named well enough to find
 * the line in it. */
function anotherDateNote(extract: DocumentData): string {
  const { unit, office } = unitOf(extract);
  const where = [
    unit,
    office,
    typeof extract.declarationYear === "number"
      ? `za ${extract.declarationYear} r.`
      : null,
    typeof extract.page === "number"
      ? `strona ${extract.page + 1} pliku`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    "Automatyczne porównanie z oświadczeniem majątkowym: data urodzenia " +
    `odczytana z oświadczenia (${where}) nie zgadza się z datą zapisaną na ` +
    "tej stronie. Nic nie zostało zmienione ani odpięte. Do sprawdzenia, czy " +
    "to ta sama osoba i która data jest właściwa."
  );
}

/** Adds the crop to the page's publication record, in a transaction: two
 * crops of one person settled at once must not each write their own list. */
async function recordPublication(
  db: Firestore,
  pageId: string,
  args: {
    outcome: "queued" | "held" | "confirmed";
    /** The crop's date is an admin's: `held` then means `admin_decision`. */
    byAdmin: boolean;
    extractId: string;
    declaration: LinkedDeclaration;
    now: Date;
  },
): Promise<boolean> {
  const ref = db.collection(PUBLICATIONS).doc(pageId);
  return db.runTransaction(async (tx) => {
    const existing = (await tx.get(ref)).data() as
      StoredPublication | undefined;
    const next = nextPublication(existing, pageId, args);
    if (!next) return false;
    tx.set(ref, next, { merge: true });
    return true;
  });
}

/** Where a page's record goes once one more crop has the page's date, as the
 * fields to merge into it, or null when nothing changes.
 *
 * Published and publishing stay what they are: the page is up, or going up.
 * A hold outlasts a later match - it is a doubt nobody has settled - unless
 * the page has become public since, which settles it. Two pages with the
 * crop's date hold the page whatever it was waiting for; on a page being
 * published that is left as the reason for the pass that holds its slot,
 * which holds the page and gives the slot back (`publishPage`): taking the
 * status from under it here would strand the slot.
 *
 * An admin's date only ever holds a page: one no record names yet, or one an
 * admin's date holds already. It joins no other record, where it would be
 * linked on the page and read as a match when the page is published. A
 * reading nobody chose takes a page only an admin's date held over as if it
 * were new, without the admin's crops: that hold stood for no doubt, only for
 * the lack of such a reading.
 */
function nextPublication(
  existing: StoredPublication | undefined,
  pageId: string,
  args: {
    outcome: "queued" | "held" | "confirmed";
    byAdmin: boolean;
    extractId: string;
    declaration: LinkedDeclaration;
    now: Date;
  },
): Partial<StoredPublication> | null {
  const adminHold =
    existing?.status === "held" && existing.reason === "admin_decision";
  if (args.byAdmin && existing && !adminHold) return null;
  const before = adminHold && !args.byAdmin ? undefined : existing;
  const was = before?.status;
  const status: PublicationStatus =
    was === "published" || was === "publishing"
      ? was
      : args.outcome === "queued" && was === "held"
        ? "held"
        : args.outcome;
  const reason: PublicationHoldReason | null =
    status === "held"
      ? (before?.reason ?? (args.byAdmin ? "admin_decision" : "two_pages"))
      : status === "publishing" &&
          (args.outcome === "held" || before?.reason === "two_pages")
        ? "two_pages"
        : null;
  const knownIds = before?.extractIds ?? [];
  const known = before?.declarations ?? [];
  const extractIds = unique([...knownIds, args.extractId]);
  const declarations = withDeclaration(known, args.declaration);

  if (
    before &&
    was === status &&
    (before.reason ?? null) === reason &&
    extractIds.length === knownIds.length &&
    declarations.length === known.length
  ) {
    return null;
  }

  const at = Timestamp.fromDate(args.now);
  return {
    personId: pageId,
    status,
    reason,
    extractIds,
    declarations,
    updatedAt: at,
    ...(existing ? {} : { createdAt: at }),
    // When the page first waited: the queue is first come, first served by
    // it, and the admin list of held pages is ordered by it, so a page held
    // the moment it matched - two pages with one date - is stamped too.
    ...((status === "queued" || status === "held") && !before?.queuedAt
      ? { queuedAt: at }
      : {}),
    ...(status === "held" && was !== "held" ? { heldAt: at } : {}),
  };
}

/** The declarations with one more, unless it is linked already: one file is
 * one declaration however many of its pages were cut. */
function withDeclaration(
  declarations: readonly LinkedDeclaration[],
  declaration: LinkedDeclaration,
): LinkedDeclaration[] {
  const key = (d: LinkedDeclaration) => `${d.url}|${d.year}`;
  return declarations.some((d) => key(d) === key(declaration))
    ? [...declarations]
    : [...declarations, declaration];
}

function sameOutcomes(
  stored: unknown,
  outcomes: Record<string, PageOutcome>,
): boolean {
  if (!stored || typeof stored !== "object") return false;
  const before = stored as Record<string, unknown>;
  const keys = Object.keys(outcomes);
  return (
    Object.keys(before).length === keys.length &&
    keys.every((key) => before[key] === outcomes[key])
  );
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/**
 * Publishes queued pages, oldest first, while the Warsaw day's count is under
 * `limit`. Takes up no new page at a limit of 0, which is how the automatic
 * publication is switched off, and does nothing at all inside
 * `PEOPLE_IMPORT_WINDOW` or while a people import is running
 * (`peopleImportRunning`).
 *
 * Two steps a page. A transaction claims it - `queued` to `publishing` - and
 * takes a slot of the day, only while slots are left; then `publishPage` does
 * the writes, which are too many for one transaction. A page held on the way
 * gives its slot back, so a day's limit counts pages that went up. A pass that
 * dies after the claim leaves the page `publishing`; the first pass
 * `STUCK_PUBLISHING_MS` later takes it up again under the slot it already
 * holds, and `publishPage` carries on from wherever the writes stopped. That
 * one is finished at a limit of 0 too where the page is public already: the
 * page went up under the limit of its day, and leaving it without the
 * relations it went up for is the one state nobody chose.
 *
 * `pressedBy` makes the pass an admin's press of „Opublikuj z kolejki” on
 * /admin/oswiadczenia, with the admin's uid: publishing from the queue is an
 * admin's decision. A press takes up the queue past the limit, at 0 too, and
 * in no slot of the day: the slots are the automation's, which „Dziś” on the
 * overview counts, so a page held on the way has none to give back. Its claim
 * names the admin, and a page it puts up is not one the site published on its
 * own (`autoPublished`). The night window and a running import stop it as
 * they stop every pass, since the import's stale write would take the page
 * down again, and `publishPage` holds a page for it as for the automation.
 * A stuck page is finished on the terms it was claimed on, whichever pass
 * takes it up again: the automation's under its slot, a press's without one.
 * A press ends by counting the pages still waiting (`waiting`), for the admin
 * to press again.
 *
 * `maxPages` bounds the pages one call takes up; the reader whose answer
 * settled a crop is waiting for their next one, and the admin who pressed for
 * the page to answer (`PRESS_BATCH`).
 */
export async function drainPublications(
  db: Firestore,
  now: Date,
  limit: number,
  options: { maxPages?: number; pressedBy?: string } = {},
): Promise<DrainResult> {
  const pressedBy = options.pressedBy || null;
  // Whether the pass takes up new pages: the automation while it has a
  // limit, a press always.
  const on = limit > 0 || pressedBy !== null;
  const result: DrainResult = {
    day: warsawDate(now),
    limit,
    skipped: on ? null : "off",
    published: [],
    held: [],
    confirmed: [],
    failed: [],
    capReached: false,
    waiting: null,
  };
  const withWaiting = async (pass: DrainResult): Promise<DrainResult> =>
    pressedBy ? { ...pass, waiting: await stillWaiting(db) } : pass;
  if (inPeopleImportWindow(now)) {
    return withWaiting({ ...result, skipped: "night" });
  }

  const maxPages = options.maxPages ?? DRAIN_BATCH;
  const publications = db.collection(PUBLICATIONS);
  const stuckBefore = Timestamp.fromDate(
    new Date(now.getTime() - STUCK_PUBLISHING_MS),
  );
  const [stuckSnapshot, queuedSnapshot] = await Promise.all([
    publications
      .where("status", "==", "publishing")
      .where("claimedAt", "<=", stuckBefore)
      .orderBy("claimedAt", "asc")
      .limit(maxPages)
      .get(),
    on
      ? publications
          .where("status", "==", "queued")
          .orderBy("queuedAt", "asc")
          .limit(maxPages)
          .get()
      : null,
  ]);
  const stuckIds = stuckSnapshot.docs.map((doc) => doc.id);
  // The interrupted ones first: they were claimed already, under a slot of
  // their day or at a press.
  const ids = [
    ...(on ? stuckIds : await publicPages(db, stuckIds)),
    ...(queuedSnapshot?.docs.map((doc) => doc.id) ?? []),
  ];
  if (ids.length === 0) return withWaiting(result);
  if (await peopleImportBusy(now)) {
    return withWaiting({ ...result, skipped: "import" });
  }

  let taken = 0;
  for (const id of ids) {
    if (taken >= maxPages) break;
    const claim = await claimPublication(db, id, now, limit, pressedBy);
    if (claim === "cap") {
      result.capReached = true;
      break;
    }
    if (!claim) continue;
    taken += 1;
    try {
      const outcome = await publishPage(db, id, now);
      if (outcome.status === "published") {
        result.published.push(id);
        continue;
      }
      await releaseClaim(db, id, claim, outcome, now);
      if (outcome.status === "held") {
        result.held.push({ personId: id, reason: outcome.reason });
      } else {
        result.confirmed.push(id);
      }
    } catch (error) {
      console.error(`[declarations] publishing ${id} failed`, error);
      result.failed.push(id);
    }
  }
  return withWaiting(result);
}

/** The pages waiting in the queue, as the overview counts them: queued, or
 * taken up and not finished yet - by a pass under way, or by one cut short,
 * which the next takes up again. */
async function stillWaiting(db: Firestore): Promise<number> {
  const publications = db.collection(PUBLICATIONS);
  const counts = await Promise.all(
    (["queued", "publishing"] as const).map(
      async (status) =>
        (await publications.where("status", "==", status).count().get()).data()
          .count,
    ),
  );
  return counts.reduce((sum, count) => sum + count, 0);
}

/** Claims a page for this pass: a queued one takes a slot of the day if one
 * is left ("cap" if not), or at an admin's press none, in the admin's name; a
 * stuck one is taken up again on its own terms, its slot or its press. Null
 * when another pass got there first. */
async function claimPublication(
  db: Firestore,
  pageId: string,
  now: Date,
  limit: number,
  pressedBy: string | null,
): Promise<Claim | "cap" | null> {
  const ref = db.collection(PUBLICATIONS).doc(pageId);
  return db.runTransaction(async (tx) => {
    const publication = (await tx.get(ref)).data() as
      StoredPublication | undefined;
    const at = Timestamp.fromDate(now);
    if (publication?.status === "publishing") {
      if (millisOf(publication.claimedAt) > now.getTime() - STUCK_PUBLISHING_MS)
        return null;
      tx.update(ref, { claimedAt: at, updatedAt: at });
      return {
        day: publication.pressedBy
          ? null
          : (publication.day ?? warsawDate(now)),
        claimedAt: at,
      };
    }
    if (publication?.status !== "queued") return null;

    // A page can come back to the queue with an earlier claim's terms still
    // on its record, so each claim clears the other kind's.
    if (pressedBy) {
      tx.update(ref, {
        status: "publishing",
        claimedAt: at,
        pressedBy,
        day: FieldValue.delete(),
        updatedAt: at,
      });
      return { day: null, claimedAt: at };
    }
    const day = warsawDate(now);
    const limitRef = db.collection(PUBLISH_LIMITS).doc(day);
    const count = Number((await tx.get(limitRef)).get("count") ?? 0);
    if (count >= limit) return "cap";
    tx.set(limitRef, { day, count: count + 1, updatedAt: at }, { merge: true });
    tx.update(ref, {
      status: "publishing",
      claimedAt: at,
      day,
      pressedBy: FieldValue.delete(),
      updatedAt: at,
    });
    return { day, claimedAt: at };
  });
}

/** Gives a page's slot back, where it took one, and records why it did not go
 * up, together - but only while the page is still this pass's: `publishing`,
 * under the claim it wrote. A pass slower than `STUCK_PUBLISHING_MS` has been
 * overtaken by the one that took the page up again, and what that one
 * recorded, and the slot it holds, are not this one's to change. */
async function releaseClaim(
  db: Firestore,
  pageId: string,
  claim: Claim,
  outcome: Exclude<PublishOutcome, { status: "published" }>,
  now: Date,
): Promise<void> {
  const ref = db.collection(PUBLICATIONS).doc(pageId);
  // A press took no slot, so it has none to give back.
  const limitRef = claim.day
    ? db.collection(PUBLISH_LIMITS).doc(claim.day)
    : null;
  await db.runTransaction(async (tx) => {
    const publicationSnapshot = await tx.get(ref);
    const limitSnapshot = limitRef ? await tx.get(limitRef) : null;
    const publication = publicationSnapshot.data() as
      StoredPublication | undefined;
    if (
      publication?.status !== "publishing" ||
      millisOf(publication.claimedAt) !== claim.claimedAt.toMillis()
    ) {
      return;
    }
    const at = Timestamp.fromDate(now);
    if (limitRef && limitSnapshot) {
      const count = Number(limitSnapshot.get("count") ?? 0);
      tx.set(
        limitRef,
        { day: claim.day, count: Math.max(0, count - 1), updatedAt: at },
        { merge: true },
      );
    }
    tx.update(
      ref,
      outcome.status === "held"
        ? { status: "held", reason: outcome.reason, heldAt: at, updatedAt: at }
        : { status: "confirmed", reason: null, updatedAt: at },
    );
  });
}

/** The ids among these whose page is public now. */
async function publicPages(
  db: Firestore,
  ids: readonly string[],
): Promise<string[]> {
  const found = await publicNodes(db, ids);
  return ids.filter((id) => found.has(id));
}

// ---------------------------------------------------------------------------
// Publishing one page
// ---------------------------------------------------------------------------

/**
 * Publishes a queued page with its KRS jobs and the candidacies its
 * declarations were filed for, as `pipeline-declarations` - or holds it.
 *
 * Everything is read again rather than trusted from when the page was queued,
 * and the page is held, with the first reason that applies, unless:
 *
 * - it is still a live person page nobody marked as two people (`needs_split`);
 * - it still has a date one of its settled crops agreed on
 *   (`no_longer_matches`), and no other live page those crops name has that
 *   date too (`two_pages`) - asked again here, since a page can gain its date
 *   after the crop was compared;
 * - nobody kept it off the site: no unpublication on record, and no revision a
 *   person approved while it is a draft (`kept_hidden`) - an approval by the
 *   import, a migration or this automation is nobody's decision to hide it;
 * - no reviewer turned down a revision of it, short of a request to remove it
 *   (`revision_rejected`);
 * - no person's proposal about it is waiting, a removal included, however old
 *   (`pending_proposal`), and its newest revision was written automatically,
 *   so it is the import's and not a person's;
 * - it shows that newest revision as it stands (`no_revision`, also when there
 *   is none): that is the revision approved on the way up where the page has
 *   none approved, so what goes live is what was checked;
 * - the name readers agreed on, where they gave one, fits the page
 *   (`name_differs`);
 * - no settled crop that names the page, or that this automation flagged on
 *   it, was read as another birth date (`conflicting_reading`);
 * - it has the candidacy the declaration was filed for - same year, the
 *   powiat or województwo the election edges point at, the office or a bare
 *   local one - and one only for each election (`no_candidacy_on_page`,
 *   `ambiguous_candidacy`);
 * - no reviewer rejected a revision of that candidacy and no person's own is
 *   waiting on it (`candidacy_reviewed`);
 * - none of its candidacies, drafts included, stand in two places in one
 *   election (`two_places`): the night's `test_nobody_stands_in_two_places_at_once`
 *   counts the published ones, and a draft beside them is a namesake's record
 *   on the page - whose committee the pipeline adds to the page's parties. A
 *   candidacy a reviewer rejected is not the page's and is left out. 169 of
 *   the 2,492 dated drafts with a candidacy on 2026-10-29 are held for this.
 *
 * Then the page goes up the way /api/nodes/publish puts it up: the import's
 * newest revision approved first, where the page has none approved or an
 * older one, in a commit of its own, then `published` with the audit row.
 * `stats.isApproved` is left to the trigger in functions/src/nodes.ts, which
 * sets it on every change of visibility, as it does for that endpoint. The
 * relations follow in batches: the chosen candidacies as a reviewer's publish
 * would put them up (`publishEdgeInBatch`), and every job at a public company
 * that the people import's own rule for verified people would put live
 * (`approveWaitingEdge`) - where the page's birth date came with the register
 * entry the jobs are listed under (`dateCameWithEntry`). A job that rule
 * refuses, or at a company still in draft, stays off the site and is listed on
 * the record.
 *
 * A page found public already was published by somebody else while it waited
 * (`confirmed`), unless the last publication on record is this automation's:
 * then a pass was cut short after the page went up, and this one finishes the
 * relations. Such a page is never held - it went up under its day's slot, or
 * at an admin's press, and a hold would give the slot back for a page that is
 * live. What came in between holds the relations it is about instead: a
 * candidacy reviewed or standing in two places, every relation of a page
 * marked as two people.
 *
 * The record says whether the site published the page on its own
 * (`autoPublished`): not where the claim it went up under is an admin's press
 * (`pressedBy`), whose name the record keeps. The audit row and the approvals
 * are still this automation's: it is what read and checked the page, and what
 * the next pass recognises as its own work to finish or put back. The publish
 * row names the admin beside it (`pressed_by`), so that /aktywnosc and
 * /eksploruj/statystyki count the press as the admin's publication.
 */
export async function publishPage(
  db: Firestore,
  pageId: string,
  now: Date = new Date(),
): Promise<PublishOutcome> {
  const publicationRef = db.collection(PUBLICATIONS).doc(pageId);
  const nodeRef = db.collection("nodes").doc(pageId);
  const [publicationSnapshot, pageSnapshot] = await db.getAll(
    publicationRef,
    nodeRef,
  );
  const publication = publicationSnapshot?.data() as
    StoredPublication | undefined;
  const page = pageSnapshot?.data();
  if (!page || page.type !== "person") return held("needs_split");

  const audit = await pageAudit(db, pageId);
  // Never true of a removed or merged page, which is not public.
  const resumed = pageIsPublic(page);
  if (resumed && !lastPublishedHere(audit)) return { status: "confirmed" };
  if (!resumed && (page.deleted === true || page.merged_into)) {
    return held("needs_split");
  }

  const [extracts, revisions] = await Promise.all([
    agreedExtracts(db, publication?.extractIds ?? []),
    nodeRevisions(db, pageId),
  ]);
  const matching = extracts.filter(
    (extract) => agreedDay(extract) === birthDateOf(page),
  );

  // `approve` is the revision that goes up with the page, where it is not
  // the one the page has approved already.
  let approve: StoredRevision | null = null;
  if (!resumed) {
    const check = await pageCheck(db, {
      pageId,
      page,
      publication,
      audit,
      revisions,
      matching,
    });
    if ("reason" in check) return held(check.reason);
    approve = check.approve;
  }

  const edges = (
    await db.collection("edges").where("source", "==", pageId).get()
  ).docs.map((doc) => ({ id: doc.id, data: doc.data() as Edge }));
  const elections = edges.filter(
    (edge) => edge.data.type === "election" && edge.data.deleted !== true,
  );
  const units = unitsOf(matching);
  const regions = await publicNodes(
    db,
    units.map((unit) => regionOf(unit)),
  );
  const choice = chooseCandidacies(elections, units, regions);
  const chosen = "chosen" in choice ? choice.chosen : [];
  if (!resumed && "reason" in choice) return held(choice.reason);

  const jobs = edges.filter(
    (edge) => edge.data.type === "employed" && edge.data.deleted !== true,
  );
  const companies = await publicNodes(
    db,
    jobs.map((job) => job.data.target),
  );
  const heldEdges: { id: string; reason: PublicationEdgeHold }[] = [];
  const waitingJobs = jobs.filter((job) => {
    const settled = settledEdgeRefusal(job.data as DocumentData);
    if (settled === "live" || settled === "deleted") return false;
    if (!companies.has(job.data.target)) {
      heldEdges.push({ id: job.id, reason: "company_draft" });
      return false;
    }
    if (settled) {
      heldEdges.push({ id: job.id, reason: settled });
      return false;
    }
    return true;
  });
  const waitingCandidacies = chosen.filter((edge) => !pageIsPublic(edge.data));
  // Every candidacy's, not only the chosen ones': a reviewer's no on any of
  // them says which records on the page are not the person's.
  const edgeRevisions = await edgeRevisionsForMany(db, [
    ...elections.map((edge) => edge.id),
    ...waitingJobs.map((job) => job.id),
  ]);

  // Somebody's word on a candidacy: a reviewer's no, or a person's own
  // version of it waiting. Before the page is up that holds the page; in a
  // pass finishing another's, the page is up already, and only the candidacy
  // stays off the site.
  const reviewed = new Map<string, PublicationEdgeHold>();
  for (const edge of waitingCandidacies) {
    const own = edgeRevisions.get(edge.id) ?? [];
    if (own.some((each) => each.status === "rejected")) {
      reviewed.set(edge.id, "rejected");
    } else if (
      own.some((each) => each.status === "pending" && writtenByPerson(each))
    ) {
      reviewed.set(edge.id, "by_hand");
    }
  }
  const chosenIds = new Set(chosen.map((edge) => edge.id));
  const clashing = clashingCandidacies(
    pageId,
    elections.filter(
      (edge) =>
        chosenIds.has(edge.id) ||
        !(edgeRevisions.get(edge.id) ?? []).some(
          (each) => each.status === "rejected",
        ),
    ),
  );
  if (!resumed) {
    if (reviewed.size > 0) return held("candidacy_reviewed");
    if (clashing.size > 0) return held("two_places");
  }
  // A page marked as two people after it went up: nothing more goes up with
  // it until somebody splits it.
  const stopped = resumed && !!page.needs_split;
  const candidaciesToPublish = waitingCandidacies.filter((edge) => {
    const reason: PublicationEdgeHold | undefined = stopped
      ? "needs_split"
      : (reviewed.get(edge.id) ??
        (clashing.has(edge.id) ? "two_places" : undefined));
    if (reason) heldEdges.push({ id: edge.id, reason });
    return !reason;
  });

  const fromEntry = dateCameWithEntry(page, revisions);
  const jobsToPublish = waitingJobs.filter((job) => {
    const refusal = waitingEdgeRefusal(
      job.data as DocumentData,
      edgeRevisions.get(job.id) ?? [],
    );
    if (refusal === "live" || refusal === "deleted") return false;
    const reason: PublicationEdgeHold | null =
      refusal ??
      (stopped ? "needs_split" : fromEntry ? null : "date_not_from_entry");
    if (reason) heldEdges.push({ id: job.id, reason });
    return !reason;
  });

  let approvedRevision: string | null = null;
  if (!resumed) {
    // Its own commit, before the one below, as in /api/nodes/publish: the
    // worst a failure in between leaves is a page approved and still hidden,
    // which the next pass recognises as this automation's (`keptHidden`). No
    // notification: the revision is the import's, and its author is a robot
    // (`notifyRevisionReviewed` would find nobody to tell).
    if (approve) {
      await applyRevision(
        db,
        db.collection("revisions").doc(approve.id),
        approve,
        actor,
      );
      approvedRevision = approve.id;
    }
    const batch = db.batch();
    batch.update(nodeRef, {
      published: true,
      [CONTENT_CHANGED_AT]: now.toISOString(),
    });
    recordAudit(
      db,
      {
        action: "publish",
        collection: "nodes",
        target_id: pageId,
        user: DECLARATION_ACTOR,
        // The admin, where the page goes up under the claim of their press.
        // Not where a sweep puts a page back after a stale write
        // (`restoreReverted`, record `published`): that is this automation
        // repairing its own work, and nobody deciding a second time.
        ...(publication?.status === "publishing" && publication.pressedBy
          ? { pressed_by: publication.pressedBy }
          : {}),
      },
      batch,
    );
    await batch.commit();
  }

  const published = await publishRelations(
    db,
    [
      ...candidaciesToPublish.map((edge) => ({
        ...edge,
        kind: "candidacy" as const,
      })),
      ...jobsToPublish.map((job) => ({ ...job, kind: "job" as const })),
    ],
    edgeRevisions,
  );

  const at = Timestamp.fromDate(now);
  // What earlier passes put up stays on the record: a page put back after a
  // stale write finds its relations live already, and publishes none.
  const edgesRecord = {
    published: unique([...(publication?.edges?.published ?? []), ...published]),
    held: heldEdges,
  };
  await publicationRef.set(
    {
      personId: pageId,
      status: "published",
      reason: null,
      publishedAt: at,
      // The day of the slot it went up under. A page an admin pressed for
      // took none, and was not published by the site on its own.
      ...(publication?.pressedBy
        ? {}
        : { day: publication?.day ?? warsawDate(now) }),
      autoPublished: !publication?.pressedBy,
      // A pass that finishes another's does not know what that one approved.
      ...(resumed ? {} : { approvedRevision }),
      edges: edgesRecord,
      updatedAt: at,
    },
    { merge: true },
  );
  console.info(
    `[declarations] published ${pageId} with ${published.length} relation(s), ` +
      `${heldEdges.length} held`,
  );
  return { status: "published", approvedRevision, edges: edgesRecord };
}

function held(reason: PublicationHoldReason): PublishOutcome {
  return { status: "held", reason };
}

/** The checks on the page itself, before it first goes up, in the order the
 * reasons are reported (`publishPage`): the first that applies, or the
 * revision to approve on the way up - null where the page shows the one it
 * has approved already. */
async function pageCheck(
  db: Firestore,
  args: {
    pageId: string;
    page: DocumentData;
    publication: StoredPublication | undefined;
    audit: readonly AuditEntry[];
    revisions: readonly StoredRevision[];
    matching: readonly DocumentData[];
  },
): Promise<
  { reason: PublicationHoldReason } | { approve: StoredRevision | null }
> {
  const { pageId, page, publication, audit, revisions, matching } = args;
  if (page.needs_split) return { reason: "needs_split" };
  if (matching.length === 0) return { reason: "no_longer_matches" };
  if (
    publication?.reason === "two_pages" ||
    (await anotherPageBornThatDay(db, pageId, matching))
  ) {
    return { reason: "two_pages" };
  }
  if (await keptHidden(db, page, audit, revisions)) {
    return { reason: "kept_hidden" };
  }
  // A request to remove the page that a reviewer turned down is the one no
  // that says the page should stay; any other is a reviewer disputing what
  // the page says, which the automation does not settle by approving an
  // older revision of the import's in its place.
  if (
    revisions.some(
      (revision) =>
        revision.status === "rejected" &&
        (revision.data as DocumentData | undefined)?.deleted !== true,
    )
  ) {
    return { reason: "revision_rejected" };
  }
  // Every revision, not just the newest: a removal request is never the
  // revision a page would go up with, and the import files a revision of its
  // own over a correction it knows nothing about.
  if (
    revisions.some(
      (revision) => revision.status === "pending" && writtenByPerson(revision),
    )
  ) {
    return { reason: "pending_proposal" };
  }
  const newest = latestPublishableRevision([...revisions]);
  if (newest && newest.update_automatic !== true) {
    return { reason: "pending_proposal" };
  }
  // Approving writes the revision over the page, so it has to be the page as
  // it stands: the date the readers matched, the name they checked, and
  // nothing the page has lost since, the way an edge is approved only where
  // it holds the revision (`publishCandidateRevision`). Of the 5,946 dated
  // drafts of 2026-10-29 with none approved and the import's revision the
  // newest, 34 did not show it.
  if (!newest || !holdsRevision(page, newest.data)) {
    return { reason: "no_revision" };
  }
  const misnamed = matching.some(
    (extract) =>
      typeof extract.agreedName === "string" &&
      extract.agreedName.trim() !== "" &&
      !nameFitsPage(extract.agreedName, String(page.name ?? "")),
  );
  if (misnamed) return { reason: "name_differs" };
  if (await anotherReading(db, pageId, birthDateOf(page))) {
    return { reason: "conflicting_reading" };
  }
  return {
    approve: approvedRevisionId(page.revision_id) === newest.id ? null : newest,
  };
}

/** The page's own rows of the audit log. */
async function pageAudit(db: Firestore, pageId: string): Promise<AuditEntry[]> {
  const snapshot = await db
    .collection("audit")
    .where("target_id", "==", pageId)
    .get();
  return snapshot.docs
    .map((doc) => doc.data() as AuditEntry)
    .filter((row) => row.collection === "nodes");
}

/** Whether the last decision on record about who may see the page is this
 * automation publishing it. */
function lastPublishedHere(audit: readonly AuditEntry[]): boolean {
  const last = audit
    .filter((row) => row.action === "publish" || row.action === "unpublish")
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .at(-1);
  return last?.action === "publish" && last.user === DECLARATION_ACTOR;
}

/** Whether somebody kept the page off the site: took it off once, or
 * approved a revision of it and left it hidden.
 *
 * Only a person's approval is such a decision. The import approves its own
 * revisions where it is told to (`autoapprove`), the merge migrations approve
 * what they write, and this automation approves the import's revision in a
 * pass that may stop before the page goes up: 99 of the 113 drafts with an
 * approved revision on 2026-10-29 were approved by one of those, none of them
 * a person choosing to keep a page hidden. An approval with nobody on record
 * is counted as a person's. */
async function keptHidden(
  db: Firestore,
  page: DocumentData,
  audit: readonly AuditEntry[],
  revisions: readonly StoredRevision[],
): Promise<boolean> {
  if (audit.some((row) => row.action === "unpublish")) return true;
  const approved = approvedRevisionId(page.revision_id);
  if (!approved) return false;
  const revision =
    revisions.find((each) => each.id === approved) ??
    ((await db.collection("revisions").doc(approved).get()).data() as
      Revision | undefined);
  return !isAutomatedUid(revision?.review_user);
}

/** Whether a live page other than this one, among those the crops name, has
 * the date they agreed on. The crop was compared with its pages when it
 * settled; one of them may have had no date then, and the import may have
 * brought it since. */
async function anotherPageBornThatDay(
  db: Firestore,
  pageId: string,
  extracts: readonly DocumentData[],
): Promise<boolean> {
  for (const extract of extracts) {
    const agreed = agreedDay(extract);
    const pages = await livePages(db, asStrings(extract.personIds));
    if (
      pages.some(
        (page) => page.id !== pageId && birthDateOf(page.data) === agreed,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Whether a settled crop the page is named on, or that this automation
 * flagged on it, was read as a date the page does not have. A declaration of
 * the same person that disagrees is a doubt the matching one does not settle,
 * and the note the automation filed about it is still waiting for somebody.
 * The flagged ones are read again rather than counted, so a page whose date a
 * reviewer has since corrected to the reading is not held for it. */
async function anotherReading(
  db: Firestore,
  pageId: string,
  born: string,
): Promise<boolean> {
  const [note, named] = await Promise.all([
    db.collection("notes").doc(`${pageId}_${DECLARATION_ACTOR}`).get(),
    db
      .collection(EXTRACTS)
      .where("personIds", "array-contains", pageId)
      .limit(READINGS_PER_PAGE)
      .get(),
  ]);
  const crops = new Map<string, DocumentData>(
    named.docs.map((doc) => [doc.id, doc.data()]),
  );
  const flagged = unique(
    ((note.data() as Note | undefined)?.sources ?? [])
      .map((entry) => entry.declarationExtractId)
      .filter((id): id is string => typeof id === "string" && !crops.has(id)),
  );
  if (flagged.length > 0) {
    const snapshots = await db.getAll(
      ...flagged.map((id) => db.collection(EXTRACTS).doc(id)),
    );
    for (const snapshot of snapshots) {
      const data = snapshot.data();
      if (data) crops.set(snapshot.id, data);
    }
  }
  return [...crops.values()].some((crop) => {
    const day = agreedDay(crop);
    return day !== null && day !== born;
  });
}

/** Whether the page's birth date came with the register entry its jobs are
 * listed under, so that a declaration confirming the date says something
 * about whose jobs they are.
 *
 * The jobs on a page are its register entry's: the import never sends a page
 * another entry's payload (`refuseAnotherEntry`). The date need not be that
 * entry's. The import never rewrites a stored one, so a page that linked its
 * entry before a person typed a date, or got its date from somewhere else
 * first, can store somebody else's: seven pages of the 10-10 export reached
 * through their own entry did, four of them a namesake's. A councillor whose
 * declaration matches that date is the date's owner, and the entry's board
 * seats would go up under the councillor's name.
 *
 * So the oldest revision that carries the date must have been written by the
 * import, not a person, and link the entry the page links now - or none, on a
 * page with none, whose jobs came from payloads the import matched to it by
 * name and that very date. 5,960 of the 6,017 dated drafts of 2026-10-29
 * qualify.
 */
function dateCameWithEntry(
  page: DocumentData,
  revisions: readonly StoredRevision[],
): boolean {
  const born = birthDateOf(page);
  const first = revisions
    .filter((revision) => {
      const data = revision.data as DocumentData | undefined;
      return (
        revision.status !== "rejected" &&
        data?.deleted !== true &&
        birthDateOf(data) === born
      );
    })
    .sort(oldestFirst)[0];
  if (!first || writtenByPerson(first)) return false;
  return (
    registerEntry((first.data as DocumentData).rejestrIo) ===
    registerEntry(page.rejestrIo)
  );
}

function oldestFirst(a: StoredRevision, b: StoredRevision): number {
  const timeA = normalizeUpdateTime(a.update_time) ?? "";
  const timeB = normalizeUpdateTime(b.update_time) ?? "";
  if (timeA !== timeB) return timeA < timeB ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/** The crops still settled on a full date, of those named. One an admin has
 * settled since it was recorded is left out: an admin's date is no match the
 * automation acts on (`matchPages`), so a page whose crop an admin corrected
 * to the page's date is held as no longer matching, not published on it. */
async function agreedExtracts(
  db: Firestore,
  ids: readonly string[],
): Promise<DocumentData[]> {
  if (ids.length === 0) return [];
  const snapshots = await db.getAll(
    ...unique(ids).map((id) => db.collection(EXTRACTS).doc(id)),
  );
  return snapshots
    .map((snapshot) => snapshot.data())
    .filter(
      (data): data is DocumentData =>
        agreedDay(data) !== null && !settledByAdmin(data),
    );
}

/**
 * The declarations a page's record may show on the page
 * (/api/nodes/<id>/declarations): those of its crops that still confirm the
 * page's birth date as it stands, settled on that very day by readers or by
 * the job and never by an admin (`agreedExtracts`), each file once.
 *
 * The record lists the crops that matched when it was written, and nothing
 * takes one off it: since then a reviewer may have corrected the page's
 * date, and an admin may have withdrawn the crop or settled it on another
 * day, the page's new one included. So the crops are read again here, the
 * way `publishPage` reads them, rather than the record trusted.
 */
export async function confirmedDeclarations(
  db: Firestore,
  record: DocumentData | undefined,
  page: DocumentData,
): Promise<LinkedDeclaration[]> {
  const born = birthDateOf(page);
  if (!born) return [];
  const crops = await agreedExtracts(db, asStrings(record?.extractIds));
  return crops
    .filter((crop) => agreedDay(crop) === born)
    .reduce<LinkedDeclaration[]>(
      (linked, crop) => withDeclaration(linked, declarationOf(crop)),
      [],
    );
}

type Unit = {
  teryt: string;
  level?: string;
  office: string;
  year: number;
};

/** The units the crops were filed for, each once. */
function unitsOf(extracts: readonly DocumentData[]): Unit[] {
  const units = new Map<string, Unit>();
  for (const extract of extracts) {
    for (const unit of Array.isArray(extract.units) ? extract.units : []) {
      if (typeof unit?.teryt !== "string" || !unit.office || !unit.year) {
        continue;
      }
      units.set(`${unit.teryt}|${unit.office}|${unit.year}`, unit as Unit);
    }
  }
  return [...units.values()];
}

/** The region node a unit's candidacies point at. The election edges are
 * filed under the powiat (a gmina's or a city's) or the województwo (the
 * sejmik), never under the gmina itself. */
function regionOf(unit: Unit): string {
  const digits = unit.level === "wojewodztwo" ? 2 : 4;
  return `teryt${unit.teryt.slice(0, digits)}`;
}

/** The ids among these whose node is public. */
async function publicNodes(
  db: Firestore,
  ids: readonly string[],
): Promise<Set<string>> {
  const wanted = unique(ids.filter((id) => typeof id === "string" && id));
  const found = new Set<string>();
  for (let i = 0; i < wanted.length; i += 100) {
    const snapshots = await db.getAll(
      ...wanted.slice(i, i + 100).map((id) => db.collection("nodes").doc(id)),
    );
    for (const snapshot of snapshots) {
      if (snapshot.exists && pageIsPublic(snapshot.data() ?? {})) {
        found.add(snapshot.id);
      }
    }
  }
  return found;
}

type StoredEdge = { id: string; data: Edge };

/** The page's candidacies the declaration was filed for: for each unit, the
 * one election edge of its year in its region, for its office or a bare local
 * one („Samorząd”, or none in a year of local elections only). A by-election
 * is a contest of its own and never one of them. Two edges for one election
 * leave the automation unable to say which is the declaration's. */
function chooseCandidacies(
  elections: readonly StoredEdge[],
  units: readonly Unit[],
  publicRegions: ReadonlySet<string>,
):
  | { chosen: StoredEdge[] }
  | { reason: "no_candidacy_on_page" | "ambiguous_candidacy" } {
  const chosen = new Map<string, StoredEdge>();
  const byElection = new Map<string, Set<string>>();
  for (const unit of units) {
    const region = regionOf(unit);
    const matches = elections.filter(
      ({ data }) =>
        data.by_election !== true &&
        String(data.start_date ?? "").slice(0, 4) === String(unit.year) &&
        data.target === region &&
        (data.position === unit.office || unnamedLocal(data)),
    );
    if (matches.length > 1) return { reason: "ambiguous_candidacy" };
    // A relation cannot go up while one of its ends is a draft.
    if (!publicRegions.has(region)) continue;
    const election = `${unit.year}|${unit.office}`;
    for (const match of matches) {
      chosen.set(match.id, match);
      byElection.set(
        election,
        (byElection.get(election) ?? new Set()).add(match.id),
      );
    }
  }
  if ([...byElection.values()].some((ids) => ids.size > 1)) {
    return { reason: "ambiguous_candidacy" };
  }
  if (chosen.size === 0) return { reason: "no_candidacy_on_page" };
  return { chosen: [...chosen.values()] };
}

/** Whether a revision is a person's word: written by hand, by somebody who is
 * not a pipeline or a migration. The old uploader wrote under a person's uid
 * with `update_automatic` set, and the merge migrations without it. */
function writtenByPerson(revision: Revision): boolean {
  return (
    revision.update_automatic !== true && !isAutomatedUid(revision.update_user)
  );
}

/** The ids of the candidacies among `rows` that put the person in two places
 * in one election - grouped by the election, the way the night counts them,
 * so a European run beside a local one in 2024 is two contests. */
function clashingCandidacies(
  pageId: string,
  rows: readonly StoredEdge[],
): Set<string> {
  const clashes = placeClashes(rows, ({ data }) => {
    const election = candidacyElection(
      data.start_date,
      data.position,
      data.by_election,
    );
    return election
      ? {
          personId: pageId,
          regionId: data.target,
          startDate: data.start_date,
          position: election,
        }
      : undefined;
  });
  return new Set(clashes.flatMap((clash) => clash.rows.map((row) => row.id)));
}

/** Puts the relations up, `EDGE_PUBLISH_CHUNK` a commit. The ids that went
 * up. */
async function publishRelations(
  db: Firestore,
  relations: readonly (StoredEdge & { kind: "candidacy" | "job" })[],
  revisions: Map<string, StoredRevision[]>,
): Promise<string[]> {
  const published: string[] = [];
  for (let i = 0; i < relations.length; i += EDGE_PUBLISH_CHUNK) {
    const batch = db.batch();
    const done: string[] = [];
    for (const relation of relations.slice(i, i + EDGE_PUBLISH_CHUNK)) {
      const stored = relation.data as unknown as Record<string, unknown>;
      const own = revisions.get(relation.id) ?? [];
      if (relation.kind === "candidacy") {
        publishEdgeInBatch(
          db,
          batch,
          db.collection("edges").doc(relation.id),
          stored,
          own,
          actor,
          false,
        );
        done.push(relation.id);
      } else if (
        await approveWaitingEdge(db, batch, relation.id, stored, actor, own)
      ) {
        done.push(relation.id);
      }
    }
    await batch.commit();
    published.push(...done);
  }
  return published;
}

// ---------------------------------------------------------------------------
// A publication a stale write undid
// ---------------------------------------------------------------------------

/**
 * Finds the pages this automation published in the last `REVERT_WINDOW_DAYS`
 * that are drafts again although nobody took them down, and puts them back up
 * - or, where something since holds them, takes their relations down with
 * them and records why.
 *
 * The people import reads a page outside a transaction and writes it back
 * whole with the visibility it read (server/api/ingest/person.post.ts). A page
 * this automation publishes while that request is in flight is a draft again
 * when it lands, with no revision approved and no line in the audit log, its
 * candidacy and jobs still live, and its record still saying `published`; the
 * trigger may even leave `stats.isApproved` set on the draft. Nothing else
 * would look at it again. `drainPublications` keeps out of every run the jobs
 * report, so this is for the one that slips through: a run that did not
 * report, a request already in flight when the run began.
 *
 * "Nobody took it down" is the audit log: the last publish or unpublish of the
 * page is this automation's publish. A person who hid it is on record, and
 * their page stays down. A removed or merged page is the merge's to tidy.
 *
 * Whatever the daily limit: the page went up under the limit of its day, or
 * at an admin's press, and a page put back is not another one. A page an
 * admin pressed for is put back as one: its record keeps the admin's name,
 * and the site does not call it its own. The check is `publishPage` itself, run
 * again in full, so a page that no longer passes it is not put back; it is
 * held, and every relation still live on it is taken down
 * (`cascadeUnpublishEdges`), since none may outlive its end.
 */
export async function restoreReverted(
  db: Firestore,
  now: Date,
): Promise<SweepResult["reverted"]> {
  const result: SweepResult["reverted"] = { restored: [], held: [] };
  if (inPeopleImportWindow(now)) return result;
  const since = Timestamp.fromDate(
    new Date(now.getTime() - REVERT_WINDOW_DAYS * 86_400_000),
  );
  const recent = await db
    .collection(PUBLICATIONS)
    .where("status", "==", "published")
    .where("publishedAt", ">=", since)
    .orderBy("publishedAt", "asc")
    .limit(SWEEP_BATCH)
    .get();
  if (recent.empty) return result;
  const pages = await db.getAll(
    ...recent.docs.map((doc) => db.collection("nodes").doc(doc.id)),
  );
  const reverted: string[] = [];
  for (const snapshot of pages) {
    const page = snapshot.data();
    if (!page || pageIsPublic(page) || page.deleted === true) continue;
    if (page.merged_into) continue;
    if (lastPublishedHere(await pageAudit(db, snapshot.id))) {
      reverted.push(snapshot.id);
    }
  }
  if (reverted.length === 0) return result;
  if (await peopleImportBusy(now)) return result;

  for (const pageId of reverted) {
    console.info(`[declarations] ${pageId} is a draft again; putting it back`);
    try {
      const outcome = await publishPage(db, pageId, now);
      const at = Timestamp.fromDate(now);
      const record = db.collection(PUBLICATIONS).doc(pageId);
      if (outcome.status === "published") {
        await record.update({ revertedAt: at });
        result.restored.push(pageId);
      } else if (outcome.status === "held") {
        await cascadeUnpublishEdges(db, pageId, actor);
        await record.update({
          status: "held",
          reason: outcome.reason,
          heldAt: at,
          revertedAt: at,
          updatedAt: at,
        });
        result.held.push({ personId: pageId, reason: outcome.reason });
      }
    } catch (error) {
      // The next sweep finds it again: the record still says `published`.
      console.error(`[declarations] putting ${pageId} back failed`, error);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// After an answer, an upload, and on the job's schedule
// ---------------------------------------------------------------------------

/** Compares the crops just settled with their pages, then takes up the queue
 * once. What both the answer that settles a crop and the upload of crops that
 * come settled do. */
export async function matchAndDrain(
  db: Firestore,
  extractIds: readonly string[],
  now: Date,
  limit: number,
  options: { maxPages?: number } = {},
): Promise<{ matched: MatchResult[]; drain: DrainResult }> {
  const matched: MatchResult[] = [];
  for (const id of unique(extractIds)) {
    matched.push(await matchPages(db, id, now));
  }
  return { matched, drain: await drainPublications(db, now, limit, options) };
}

/**
 * What the job on predator calls after every upload: first copies to
 * accounts the answers they took over that a claim left uncopied
 * (`finishClaims`), then compares the settled crops that have not been
 * compared yet - an answer, a claim or an upload whose own comparison failed,
 * or a crop an upload named more pages for - and those marked to be compared
 * again (`pageRecheck`), which left a page without a birth date or with
 * another one, in case the nightly import or a reviewer has changed that
 * since. Then it puts back what a stale write took down (`restoreReverted`)
 * and takes up the queue.
 *
 * The ones compared again go least recently compared first: a crop compared
 * to no effect is stamped and goes to the back, so each sweep reaches others.
 */
export async function sweepDeclarations(
  db: Firestore,
  now: Date,
  limit: number,
  options: { batch?: number } = {},
): Promise<SweepResult> {
  const size = options.batch ?? SWEEP_BATCH;
  const claims = await finishClaims(db, now);
  const extracts = db.collection(EXTRACTS);
  const [unmatched, recheck] = await Promise.all([
    extracts
      .where("status", "==", "agreed")
      .where("agreed.kind", "==", "date")
      .where("pageMatch", "==", null)
      .limit(size)
      .get(),
    extracts
      .where("status", "==", "agreed")
      .where("pageRecheck", "==", true)
      .orderBy("pageCheckedAt", "asc")
      .limit(size)
      .get(),
  ]);

  let changed = 0;
  for (const doc of unmatched.docs) {
    if ((await matchPages(db, doc.id, now)).changed) changed += 1;
  }
  for (const doc of recheck.docs) {
    if ((await matchPages(db, doc.id, now)).changed) {
      changed += 1;
    } else {
      await extracts
        .doc(doc.id)
        .update({ pageCheckedAt: Timestamp.fromDate(now) });
    }
  }

  const reverted = await restoreReverted(db, now);
  const drain = await drainPublications(db, now, limit);
  return {
    claims,
    checked: unmatched.size + recheck.size,
    changed,
    reverted,
    drain,
  };
}

// ---------------------------------------------------------------------------

function millisOf(value: unknown): number {
  if (value && typeof (value as Timestamp).toMillis === "function") {
    return (value as Timestamp).toMillis();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
}
