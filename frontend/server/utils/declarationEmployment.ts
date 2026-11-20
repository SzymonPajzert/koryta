import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  EMPLOYMENT_FIELDS,
  employmentPriority,
  employmentStatuses,
  mayorOffices,
  readingBands,
  type EmploymentApplyState,
  type EmploymentState,
  type EmploymentStatus,
  type ReadingBand,
} from "~~/shared/declarationEmployment";
import { EXTRACTS, PUBLICATIONS } from "./declarations";
import { resolveMergedNode } from "./merge";
import { pagesWithAPublicPost } from "./publicPosts";

/**
 * The reading of posts off BIP declarations, as the server keeps it: a map a
 * band (`EMPLOYMENT_FIELDS`) on the declaration's date page,
 * `declarationExtracts/<sha256>-p<page>`; the band's pictures in
 * `declarationExtractImages/<item>-<band>`; and how many bands are in each
 * status in `stats/declaration_employment`. No collection of its own
 * (decision on 2026-11-20). The date flow reads and writes the page's
 * top-level fields only, so it never sees the maps.
 *
 * A band is read only once its declaration is known to be the person's
 * (`employmentGate`). The upload (/api/ingest/declarations/employment) and
 * every comparison of the date crop with its pages (`matchPages`) look at the
 * gate, each reading the crop afresh in a transaction, so whichever of two
 * running at once comes second sees what the other wrote.
 */

/** `stats/<id>`: bands by status, as `{ <band>: { <status>: count } }`. */
export const EMPLOYMENT_STATS = "declaration_employment";

/** The `priority` of a band no page is known for: the last tier. Only an
 * open band is served, and it opens with its page's. */
export const NO_PAGE_PRIORITY = 3;

/** The local term that sits now, elected in April 2024. */
const SITTING_TERM = 2024;

/** What the date crop says of whose declaration it is. */
export type EmploymentGate =
  { open: true; personId: string; page: DocumentData } | { open: false };

type OpenGate = Extract<EmploymentGate, { open: true }>;

const CLOSED: EmploymentGate = { open: false };

/**
 * Whether the declaration is known to be the person's: its date crop agreed
 * on a full date, and the comparison with its pages (`pageOutcomes`, which
 * `matchPages` writes) named exactly one live page `confirmed` or `queued`,
 * followed through merges. A reading of another day, two pages born that
 * day, a date an admin settled (which holds its pages) and a crop not yet
 * compared open nothing; the pilot's three wrong-person files read as
 * another day.
 */
export async function employmentGate(
  db: Firestore,
  crop: DocumentData | undefined,
): Promise<EmploymentGate> {
  if (crop?.status !== "agreed") return CLOSED;
  const agreed = crop.agreed as { kind?: unknown } | null | undefined;
  if (agreed?.kind !== "date") return CLOSED;
  const outcomes: unknown = crop.pageOutcomes;
  if (!outcomes || typeof outcomes !== "object") return CLOSED;

  const live = new Map<string, DocumentData>();
  for (const [id, outcome] of Object.entries(outcomes)) {
    if (outcome !== "confirmed" && outcome !== "queued") continue;
    const { snapshot } = await resolveMergedNode(db, id);
    const page = snapshot?.data();
    if (snapshot && page?.type === "person" && page.deleted !== true) {
      live.set(snapshot.id, page);
    }
  }
  const [only, ...more] = [...live];
  if (!only || more.length > 0) return CLOSED;
  return { open: true, personId: only[0], page: only[1] };
}

/**
 * An open band's `priority` (`employmentPriority`): its page's tier, by the
 * page's publication record and whether it has a paid public post, and half
 * a tier back for a sitting wójt, burmistrz or prezydent, whose line most
 * often names that office. No Kontrola read is served yet.
 */
export async function employmentPriorityOf(
  db: Firestore,
  gate: OpenGate,
  crop: DocumentData,
): Promise<number> {
  const [publication, paid] = await Promise.all([
    db.collection(PUBLICATIONS).doc(gate.personId).get(),
    pagesWithAPublicPost(db, [gate.personId]),
  ]);
  return employmentPriority({
    page: gate.page,
    paidPost: paid.has(gate.personId),
    publication: publication.data() ?? null,
    sittingMayor: sittingMayor(crop.units),
  });
}

/** Whether the crop was cut for a mayoral office won in the sitting term:
 * its units are the won candidacies it serves. */
function sittingMayor(units: unknown): boolean {
  const offices: readonly unknown[] = mayorOffices;
  return (
    Array.isArray(units) &&
    units.some(
      (unit: { office?: unknown; year?: unknown } | null) =>
        offices.includes(unit?.office) && unit?.year === SITTING_TERM,
    )
  );
}

/** A band's map as stored, as far as anybody wrote it. */
export type StoredBand = Partial<EmploymentState<Timestamp>>;

/** The band's map on the crop, if the crop has one. */
export function storedBand(
  crop: DocumentData | undefined,
  band: ReadingBand,
): StoredBand | undefined {
  const map: unknown = crop?.[EMPLOYMENT_FIELDS[band]];
  return map && typeof map === "object" && !Array.isArray(map)
    ? (map as StoredBand)
    : undefined;
}

/** What the gate reads of a band. */
export type GatedBand = {
  status: EmploymentStatus;
  answerCount: number;
  applyState: EmploymentApplyState | null;
  personId: string | null;
};

const STATUSES: ReadonlySet<unknown> = new Set(employmentStatuses);

/** The stored band as the gate reads it: a field nobody wrote reads as a
 * band just stored. */
export function gatedBand(band: StoredBand): GatedBand {
  const answers = Number(band.answerCount);
  return {
    status: STATUSES.has(band.status) ? band.status! : "waiting",
    answerCount: Number.isFinite(answers) ? answers : 0,
    applyState: band.applyState ?? null,
    personId: typeof band.personId === "string" ? band.personId : null,
  };
}

/** Whether anything of the band's agreed reading is on the graph. */
function written(applyState: EmploymentApplyState | null): boolean {
  return applyState === "applied" || applyState === "waiting";
}

/**
 * Where a band goes when its gate is looked at again. A waiting band opens.
 * Once the crop no longer names one page, an open band closes - back to
 * waiting while no vote is on it, else withdrawn - and so does a settled one
 * nothing has been written from. A band put off for a newer declaration
 * (`later`) or waiting for a wider cut (`recut`) stays, for the upload to
 * place, and so does one written to the graph.
 */
export function statusThroughGate(
  band: GatedBand,
  open: boolean,
): EmploymentStatus {
  if (open) return band.status === "waiting" ? "open" : band.status;
  switch (band.status) {
    case "open":
      return band.answerCount > 0 ? "withdrawn" : "waiting";
    case "agreed":
    case "unreadable":
    case "disputed":
      return written(band.applyState) ? band.status : "withdrawn";
    default:
      return band.status;
  }
}

/** The page a band reads for: the gate's, none while the band waits, and
 * otherwise the page it was read for. */
export function personThroughGate(
  status: EmploymentStatus,
  gate: EmploymentGate,
  before: string | null,
): string | null {
  if (gate.open) return gate.personId;
  return status === "waiting" || status === "later" ? null : before;
}

/** A band whose status moved; `from` is null for a band just stored. */
export type EmploymentMove = {
  band: ReadingBand;
  from: EmploymentStatus | null;
  to: EmploymentStatus;
};

/**
 * Moves `stats/declaration_employment` by the bands whose status moved, in
 * one write of increments. Never at the caller's expense: the bands are
 * stored either way.
 */
export async function countEmploymentMoves(
  db: Firestore,
  moves: readonly EmploymentMove[],
  at: Timestamp,
): Promise<void> {
  const deltas = new Map<ReadingBand, Map<EmploymentStatus, number>>();
  const add = (band: ReadingBand, status: EmploymentStatus, by: number) => {
    const counts = deltas.get(band) ?? new Map<EmploymentStatus, number>();
    counts.set(status, (counts.get(status) ?? 0) + by);
    deltas.set(band, counts);
  };
  for (const { band, from, to } of moves) {
    if (from === to) continue;
    if (from) add(band, from, -1);
    add(band, to, 1);
  }
  const data: Record<string, Record<string, unknown>> = {};
  for (const [band, counts] of deltas) {
    for (const [status, by] of counts) {
      if (by !== 0) (data[band] ??= {})[status] = FieldValue.increment(by);
    }
  }
  if (Object.keys(data).length === 0) return;
  try {
    await db
      .collection("stats")
      .doc(EMPLOYMENT_STATS)
      .set({ ...data, updatedAt: at }, { merge: true });
  } catch (error) {
    console.error("[declarations] moving the employment counts failed", error);
  }
}

/**
 * Opens a declaration's bands once its date crop names one page, and closes
 * them once it no longer does (`statusThroughGate`); an open band follows
 * its page through merges, and its `priority` follows the page's
 * publication. `matchPages` calls it after every comparison; the upload
 * places a band it stores by the same gate. A crop without bands costs one
 * read and writes nothing. Returns the bands whose status moved.
 */
export async function openEmploymentOf(
  db: Firestore,
  extractId: string,
  now: Date = new Date(),
): Promise<EmploymentMove[]> {
  const ref = db.collection(EXTRACTS).doc(extractId);
  const at = Timestamp.fromDate(now);
  const moves = await db.runTransaction(async (tx) => {
    const crop = (await tx.get(ref)).data();
    const bands = readingBands.filter((band) => storedBand(crop, band));
    if (!crop || bands.length === 0) return [];
    const gate = await employmentGate(db, crop);
    const priority = gate.open
      ? await employmentPriorityOf(db, gate, crop)
      : null;

    const update: Record<string, unknown> = {};
    const moved: EmploymentMove[] = [];
    for (const band of bands) {
      const field = EMPLOYMENT_FIELDS[band];
      const stored = storedBand(crop, band)!;
      const before = gatedBand(stored);
      const status = statusThroughGate(before, gate.open);
      const personId = personThroughGate(status, gate, before.personId);
      if (status !== stored.status || personId !== (stored.personId ?? null)) {
        update[`${field}.status`] = status;
        update[`${field}.personId`] = personId;
        update[`${field}.updatedAt`] = at;
      }
      if (
        status === "open" &&
        priority !== null &&
        stored.priority !== priority
      ) {
        update[`${field}.priority`] = priority;
      }
      if (status !== before.status) {
        moved.push({ band, from: before.status, to: status });
      }
    }
    if (Object.keys(update).length > 0) tx.update(ref, update);
    return moved;
  });
  await countEmploymentMoves(db, moves, at);
  return moves;
}

/** `openEmploymentOf`, never at the caller's expense: a comparison of a date
 * with its pages stands whatever becomes of the declaration's other
 * readings. */
export async function openEmploymentQuietly(
  db: Firestore,
  extractId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    await openEmploymentOf(db, extractId, now);
  } catch (error) {
    console.error(
      `[declarations] placing the employment reading of ${extractId} failed`,
      error,
    );
  }
}
