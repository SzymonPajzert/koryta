import type { Firestore } from "firebase-admin/firestore";
import type { Edge } from "~~/shared/model";
import { isPublicEmployment } from "~~/shared/stats";

/**
 * Which person pages have a paid public post on them: a spell, current or
 * past, at a company somebody has shown the public sector owns, and not a seat
 * on an organ nobody is paid to sit on (`isPublicEmployment`).
 *
 * The one question two parts of the declarations flow ask of a whole batch of
 * pages: which crops readers should be shown first
 * (/api/ingest/declarations), and - for a single page, which asks the
 * predicate directly with the edges it has already read - which pages the
 * automation may publish at all (`publishPage`).
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
  // keeps this to the employment edges alone.
  const jobs: { id: string; data: Edge }[] = [];
  for (let i = 0; i < wanted.length; i += 30) {
    const snapshot = await db
      .collection("edges")
      .where("source", "in", wanted.slice(i, i + 30))
      .where("type", "==", "employed")
      .get();
    for (const doc of snapshot.docs) {
      const data = doc.data() as Edge;
      if (data.deleted !== true) jobs.push({ id: doc.id, data });
    }
  }
  if (jobs.length === 0) return found;

  const companies = new Map<string, Record<string, unknown>>();
  const targets = [
    ...new Set(jobs.map((job) => job.data.target).filter(Boolean)),
  ];
  for (let i = 0; i < targets.length; i += 100) {
    const snapshots = await db.getAll(
      ...targets.slice(i, i + 100).map((id) => db.collection("nodes").doc(id)),
    );
    for (const snapshot of snapshots) {
      if (snapshot.exists) companies.set(snapshot.id, snapshot.data() ?? {});
    }
  }

  for (const job of jobs) {
    if (isPublicEmployment(job.data, companies.get(job.data.target))) {
      found.add(job.data.source);
    }
  }
  return found;
}
