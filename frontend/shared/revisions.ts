import type { Timestamp } from "firebase-admin/firestore";
import type { NodeRevisions } from "./model";

/**
 * A generic representation of a revision used for calculating the stats.
 */
export interface RevisionMinimal {
  id: string;
  update_time: string | null;
}

/**
 * Normalizes different timestamp formats into an ISO string.
 *
 * Firestore internally strictly stores dates as its `Timestamp` type, but the
 * data can arrive in different shapes depending on how it traverses the app's layers:
 * 1. `Timestamp` object (has `.toDate()`): When freshly fetched from Firestore via
 *    the `firebase-admin` or client SDK.
 * 2. Object with `_seconds`: When a `Timestamp` is serialized (e.g. `JSON.stringify`
 *    via Nuxt's SSR payload) and passed across the network, losing its class prototype.
 * 3. `string`: When a previous mapping step explicitly converted it to an ISO string.
 */
export function normalizeUpdateTime(
  updateTime: Timestamp | string | { _seconds: number } | null | undefined,
): string | null {
  if (!updateTime) return null;
  if (typeof updateTime === "string") return updateTime;
  if (typeof (updateTime as { toDate?: () => unknown }).toDate === "function") {
    return (updateTime as { toDate: () => { toISOString: () => string } })
      .toDate()
      .toISOString();
  }
  if (typeof updateTime === "object" && "_seconds" in updateTime) {
    return new Date(
      (updateTime as { _seconds: number })._seconds * 1000,
    ).toISOString();
  }
  return null;
}

export function computeRevisionsObj(
  nodeRevisionId:
    | string
    | { path: string }
    | { _path: { segments: string[] } }
    | unknown,
  revisionsArray: RevisionMinimal[],
): NodeRevisions | null {
  if (revisionsArray.length === 0) {
    return null;
  }

  const sortedRevisions = [...revisionsArray].sort((a, b) => {
    const timeA = new Date(a.update_time || 0).getTime();
    const timeB = new Date(b.update_time || 0).getTime();
    return timeB - timeA;
  });

  const latest = sortedRevisions[0];
  if (!latest) {
    return null;
  }

  let normalizedRevisionId = nodeRevisionId;
  if (normalizedRevisionId && typeof normalizedRevisionId === "object") {
    if ("path" in normalizedRevisionId) {
      normalizedRevisionId = (normalizedRevisionId as { path: string }).path;
    } else if (
      "_path" in (normalizedRevisionId as { _path: { segments: string[] } }) &&
      Array.isArray(
        (normalizedRevisionId as { _path: { segments: string[] } })._path
          .segments,
      )
    ) {
      normalizedRevisionId = (
        normalizedRevisionId as { _path: { segments: string[] } }
      )._path.segments.join("/");
    }
  }

  let has_unapproved = false;
  if (normalizedRevisionId && typeof normalizedRevisionId === "string") {
    const revIdSegments = normalizedRevisionId.split("/");
    const actualRevId = revIdSegments[revIdSegments.length - 1];
    if (latest.id !== actualRevId) {
      has_unapproved = true;
    }
  }

  return {
    latest_id: latest.id,
    latest_time: latest.update_time || null,
    total: sortedRevisions.length,
    has_unapproved,
  };
}
