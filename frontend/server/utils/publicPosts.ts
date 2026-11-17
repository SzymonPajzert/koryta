import type { Firestore } from "firebase-admin/firestore";
import type { Edge } from "~~/shared/model";
import { isPublicEmployment } from "~~/shared/stats";
import { chunksOf, inParallel } from "./parallel";

/** Requests in flight at once: the night's count asks this of thousands of
 * pages. */
const IN_PARALLEL = 8;

/**
 * Which person pages have a paid public post on them: a spell, current or
 * past, at a company somebody has shown the public sector owns, and not a seat
 * on an organ nobody is paid to sit on (`isPublicEmployment`).
 *
 * The one question the declarations flow asks of a whole batch of pages:
 * which crops readers should be shown first (/api/ingest/declarations), who
 * the people snapshot counts (server/utils/declarationPeopleCount.ts), and -
 * for a single page, which asks the predicate directly with the edges it has
 * already read - which pages the automation may publish at all
 * (`publishPage`).
 *
 * Reads the pages' own `employed` edges rather than `stats.edges`, which
 * cannot answer it: `experienceMonths` is a duration, so a post with no start
 * date on record counts for nothing there, and `currentlyEmployed` leaves out
 * every post that has ended. Drafts count: a relation still waiting for its
 * first review is the register's claim about the person all the same, and the
 * page goes up with its jobs.
 */
export async function pagesWithAPublicPost(
  db: Firestore,
  pageIds: readonly string[],
): Promise<Set<string>> {
  const wanted = [...new Set(pageIds.filter((id) => id))];
  const found = new Set<string>();
  if (wanted.length === 0) return found;

  // Firestore takes at most 30 values in an `in`; the (source, type) index
  // keeps this to the employment edges alone. Only the fields
  // `isPublicEmployment` reads come back.
  const jobs: Edge[] = [];
  await inParallel(chunksOf(wanted, 30), IN_PARALLEL, async (chunk) => {
    const snapshot = await db
      .collection("edges")
      .where("source", "in", chunk)
      .where("type", "==", "employed")
      .select("source", "target", "type", "name", "deleted")
      .get();
    for (const doc of snapshot.docs) {
      const data = doc.data() as Edge;
      if (data.deleted !== true) jobs.push(data);
    }
  });
  if (jobs.length === 0) return found;

  const companies = new Map<string, Record<string, unknown>>();
  const targets = [...new Set(jobs.map((job) => job.target).filter(Boolean))];
  await inParallel(chunksOf(targets, 100), IN_PARALLEL, async (chunk) => {
    const snapshots = await db.getAll(
      ...chunk.map((id) => db.collection("nodes").doc(id)),
      { fieldMask: ["isPublic", "supervisoryBody"] },
    );
    for (const snapshot of snapshots) {
      if (snapshot.exists) companies.set(snapshot.id, snapshot.data() ?? {});
    }
  });

  for (const job of jobs) {
    if (isPublicEmployment(job, companies.get(job.target))) {
      found.add(job.source);
    }
  }
  return found;
}
