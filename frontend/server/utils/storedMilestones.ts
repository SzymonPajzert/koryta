import type { ServiceMilestone } from "~~/server/api/edges/serviceMilestones.get";

/**
 * The service milestones window, counted once a Warsaw day for each backend
 * and kept in one document that every instance reads.
 *
 * Counting it reads every published employment and both ends of each: 21,600
 * documents on 2026-11-19. Nitro's cache lives in one instance's memory, and
 * prod ran on 30-50 instances a day and autopush on 25-30, each counting again
 * every hour it lived: 1.24M reads a day, the largest Firestore cost of the
 * site. Counted once a day per backend instead (decision on 2026-11-19).
 *
 * One document per backend, overwritten in place. autopush runs code prod does
 * not run yet, and the build is in the key, so a rollout counts again rather
 * than serving rows an older build counted.
 */
export const STORED_MILESTONES_TYPE = "serviceMilestones";

/** Which document this process keeps the window in, and what it must say. */
export interface StoredMilestonesKey {
  /** The document in `stats`. */
  docId: string;
  /** `<build>|<Warsaw day>`. */
  key: string;
}

interface StoredMilestonesDoc {
  type: typeof STORED_MILESTONES_TYPE;
  key: string;
  computedAt: string;
  milestones: ServiceMilestone[];
}

/** Where this process keeps the window, or null off Cloud Run: nuxt dev, the
 * emulators and the tests count it on every call, so a local change to how it
 * is counted never hides behind a stored result. */
export function storedMilestonesKey(today: string): StoredMilestonesKey | null {
  const backend = process.env.K_SERVICE;
  const build = process.env.K_REVISION;
  if (!backend || !build) return null;
  return { docId: `serviceMilestones_${backend}`, key: `${build}|${today}` };
}

/** The stored rows, or null when there are none for this build and day. */
export async function readStoredMilestones(
  db: FirebaseFirestore.Firestore,
  where: StoredMilestonesKey,
): Promise<ServiceMilestone[] | null> {
  const snap = await db.collection("stats").doc(where.docId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Partial<StoredMilestonesDoc> | undefined;
  if (data?.key !== where.key || !Array.isArray(data.milestones)) return null;
  return data.milestones;
}

export async function writeStoredMilestones(
  db: FirebaseFirestore.Firestore,
  where: StoredMilestonesKey,
  milestones: ServiceMilestone[],
  now: Date,
): Promise<void> {
  const doc: StoredMilestonesDoc = {
    type: STORED_MILESTONES_TYPE,
    key: where.key,
    computedAt: now.toISOString(),
    // Through JSON, which drops the optional fields a row leaves undefined:
    // Firestore refuses a document holding an undefined value.
    milestones: JSON.parse(JSON.stringify(milestones)),
  };
  await db.collection("stats").doc(where.docId).set(doc);
}
