import type {
  DocumentData,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import {
  cropPriority,
  readingPriority,
  readingReached,
} from "~~/shared/declarations";
import { pageIsPublic } from "~~/shared/model";
import { EXTRACTS } from "./declarations";
import { chunksOf, inParallel } from "./parallel";
import { pagesWithAPublicPost } from "./publicPosts";

/**
 * Where the readers' queue puts a crop (`priority`, which
 * /api/declarations/next orders by), kept in step with the readings:
 * `cropPriority` over the crop's pages.
 *
 * The ingest writes the number as it stores a crop. After that a reading
 * that reaches a person moves their other open crops to the last tier
 * (`READ_PRIORITY`), and an admin who takes the only reading back moves them
 * back (`requeueCrops`).
 */

/** Crops of one page read to tell whether a reading has reached it, as many
 * as publishing it reads: a person has a declaration a year per office. */
const CROPS_PER_PAGE = 50;

/** Queries in flight at once. */
const IN_PARALLEL = 8;

/** Writes a batch takes at most. */
const BATCH = 400;

/** A live person page, as far as the queue's order depends on it. */
export type QueuedPage = { id: string; published: boolean; birthDate: unknown };

/** Each page's tier (`readingPriority`). Whether a draft has a paid public
 * post takes the graph, so it is asked of every draft at once; a published
 * page needs none of it, since its crops come after every draft's either
 * way. */
export async function pageTiers(
  db: Firestore,
  pages: Iterable<QueuedPage>,
): Promise<Map<string, 0 | 1 | 2 | 3>> {
  const all = [...pages];
  const drafts = all.filter((page) => !page.published);
  const paid =
    drafts.length > 0
      ? await pagesWithAPublicPost(
          db,
          drafts.map((page) => page.id),
        )
      : new Set<string>();
  return new Map(
    all.map((page) => [page.id, readingPriority(page, paid.has(page.id))]),
  );
}

/** The crops that name each page, as stored. */
async function cropsNaming(
  db: Firestore,
  pageIds: readonly string[],
): Promise<Map<string, QueryDocumentSnapshot[]>> {
  const byPage = new Map<string, QueryDocumentSnapshot[]>();
  await inParallel(pageIds, IN_PARALLEL, async (id) => {
    const snapshot = await db
      .collection(EXTRACTS)
      .where("personIds", "array-contains", id)
      .limit(CROPS_PER_PAGE)
      .get();
    byPage.set(id, snapshot.docs);
  });
  return byPage;
}

function reached(
  byPage: ReadonlyMap<string, readonly QueryDocumentSnapshot[]>,
  id: string,
): boolean {
  return readingReached(
    (byPage.get(id) ?? []).map((doc) => doc.data()),
    id,
  );
}

/** Which of these pages a reading has reached (`readingReached`). */
export async function pagesReached(
  db: Firestore,
  pageIds: readonly string[],
): Promise<Set<string>> {
  const ids = pageIdsIn(pageIds);
  const byPage = await cropsNaming(db, ids);
  return new Set(ids.filter((id) => reached(byPage, id)));
}

/** The live person pages among the ids: one that is gone, removed, merged
 * into another or not a person orders nothing, as in the migration that
 * recomputes the queue. */
async function livePages(
  db: Firestore,
  ids: readonly string[],
): Promise<Map<string, QueuedPage>> {
  const pages = new Map<string, QueuedPage>();
  for (const chunk of chunksOf(ids, 100)) {
    const snapshots = await db.getAll(
      ...chunk.map((id) => db.collection("nodes").doc(id)),
    );
    for (const snapshot of snapshots) {
      const data: DocumentData | undefined = snapshot.data();
      if (
        !data ||
        data.type !== "person" ||
        data.deleted === true ||
        data.merged_into
      ) {
        continue;
      }
      pages.set(snapshot.id, {
        id: snapshot.id,
        published: pageIsPublic(data),
        birthDate: data.birthDate,
      });
    }
  }
  return pages;
}

/**
 * Puts the open crops of these pages where the queue should serve them now
 * (`cropPriority`): to the last tier once a reading has reached every page a
 * crop is for, and back to its pages' tier once none has, as when an admin
 * takes back the only reading of a person. Every page a moved crop names is
 * read, not only these. A crop that names no live page keeps its number.
 *
 * Called with the pages a comparison reached (`matchAndDrain`,
 * `sweepDeclarations`) and those of a crop an admin decided. Idempotent: it
 * writes only the numbers that change, and says how many.
 */
export async function requeueCrops(
  db: Firestore,
  pageIds: readonly string[],
): Promise<number> {
  const ids = pageIdsIn(pageIds);
  if (ids.length === 0) return 0;
  const byPage = await cropsNaming(db, ids);

  const open = new Map<string, QueryDocumentSnapshot>();
  for (const docs of byPage.values()) {
    for (const doc of docs) {
      if (doc.get("status") === "open") open.set(doc.id, doc);
    }
  }
  if (open.size === 0) return 0;

  const named = pageIdsIn(
    [...open.values()].flatMap((doc) => pageIdsIn(doc.get("personIds"))),
  );
  const others = named.filter((id) => !byPage.has(id));
  for (const [id, docs] of await cropsNaming(db, others)) byPage.set(id, docs);
  const pages = await livePages(db, named);
  const tiers = await pageTiers(db, pages.values());

  const moves: [QueryDocumentSnapshot, number][] = [];
  for (const doc of open.values()) {
    const mine = pageIdsIn(doc.get("personIds")).filter((id) => pages.has(id));
    if (mine.length === 0) continue;
    const next = cropPriority(
      mine.map((id) => ({
        tier: tiers.get(id) ?? 3,
        read: reached(byPage, id),
        birthDate: pages.get(id)!.birthDate,
      })),
      doc.get("machine.birthDate"),
    );
    if (doc.get("priority") !== next) moves.push([doc, next]);
  }
  for (const chunk of chunksOf(moves, BATCH)) {
    const batch = db.batch();
    for (const [doc, priority] of chunk) batch.update(doc.ref, { priority });
    await batch.commit();
  }
  return moves.length;
}

/** `requeueCrops`, never at the caller's expense: the queue's order is worth
 * a log line, not a failed answer, upload or decision. */
export async function requeueQuietly(
  db: Firestore,
  pageIds: readonly string[],
): Promise<void> {
  try {
    await requeueCrops(db, pageIds);
  } catch (error) {
    console.error(
      `[declarations] moving the crops of ${pageIds.join(", ")} in the queue failed`,
      error,
    );
  }
}

/** `requeueQuietly` for the people of one crop: the pages it names and the
 * pages a reading of it reached, which an admin's decision on it may have
 * left without one. */
export async function requeueCropPeople(
  db: Firestore,
  extractId: string,
): Promise<void> {
  try {
    const crop = (await db.collection(EXTRACTS).doc(extractId).get()).data();
    const outcomes: unknown = crop?.pageOutcomes;
    await requeueCrops(db, [
      ...pageIdsIn(crop?.personIds),
      ...(outcomes && typeof outcomes === "object"
        ? Object.keys(outcomes)
        : []),
    ]);
  } catch (error) {
    console.error(
      `[declarations] moving the crops of the people of ${extractId} in the queue failed`,
      error,
    );
  }
}

/** The page ids among the values, each once. */
function pageIdsIn(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.filter(
        (value): value is string => typeof value === "string" && value !== "",
      ),
    ),
  ];
}
