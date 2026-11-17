import type { HomeTimelineResponse } from "~~/server/api/stats/homeTimeline.get";

/**
 * The home page's timeline, as last counted, in one document.
 *
 * Counting it reads every published employment and both ends of each - about
 * 20,000 documents and 7 s on 2026-11-17. Nitro's cache is in memory and the
 * backend scales to zero, so an instance that had just started counted it again
 * for its first reader, who watched a skeleton for those 7 s. A document
 * outlives the instance: a cold one reads it in one round trip.
 *
 * prod and autopush share it, so a change to `HomeTimelineResponse` has to
 * still read right in the build before it, or move to a new document.
 */
export const HOME_TIMELINE_DOC = "home_timeline";

export interface HomeTimelineSnapshot {
  /** The Warsaw day it was counted on, `YYYY-MM-DD`. */
  countedOn: string;
  timeline: HomeTimelineResponse;
}

interface HomeTimelineDoc extends HomeTimelineSnapshot {
  type: "home_timeline";
  computedAt: string;
}

/** The last count, or null when there is none, or when the document does not
 * read as one - counted again rather than drawn by halves. */
export async function readHomeTimeline(
  db: FirebaseFirestore.Firestore,
): Promise<HomeTimelineSnapshot | null> {
  const snap = await db.collection("stats").doc(HOME_TIMELINE_DOC).get();
  if (!snap.exists) return null;
  const data = snap.data() as { countedOn?: unknown; timeline?: unknown };
  const timeline = data.timeline as Record<string, unknown> | undefined;
  if (
    typeof data.countedOn !== "string" ||
    !Array.isArray(timeline?.months) ||
    !isObject(timeline.groupings) ||
    !isObject(timeline.coverage)
  ) {
    return null;
  }
  return {
    countedOn: data.countedOn,
    timeline: timeline as unknown as HomeTimelineResponse,
  };
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

export async function writeHomeTimeline(
  db: FirebaseFirestore.Firestore,
  snapshot: HomeTimelineSnapshot,
  now: Date,
): Promise<void> {
  const doc: HomeTimelineDoc = {
    type: "home_timeline",
    countedOn: snapshot.countedOn,
    timeline: snapshot.timeline,
    computedAt: now.toISOString(),
  };
  await db.collection("stats").doc(HOME_TIMELINE_DOC).set(doc);
}
