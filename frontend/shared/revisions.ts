import type { Timestamp } from "firebase-admin/firestore";
import { revisionCollection, type NodeRevisions } from "./model";

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
  updateTime:
    Timestamp | string | { _seconds: number } | null | undefined | unknown,
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
    string | { path: string } | { _path: { segments: string[] } } | unknown,
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
  if (!normalizedRevisionId || typeof normalizedRevisionId !== "string") {
    // No approved revision exists, so all revisions are unapproved
    has_unapproved = true;
  } else {
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

/** A revision, as much of one as picking the newest usable one needs. */
export interface RevisionCandidate {
  id: string;
  status?: unknown;
  data?: unknown;
  update_time?: unknown;
  collection?: unknown;
}

/** The revision a page should be published with when none is approved.
 *
 * Most pages have never had a revision approved by hand, so "Opublikuj" used
 * to refuse them; publishing one means showing what it says now, and that is
 * its newest revision. Shared so that the button and `/api/nodes/publish`
 * name the same revision - the screen tells the reviewer which version they
 * are about to put in front of readers, and the server has to agree.
 *
 * Three kinds are passed over, because approving one would do something other
 * than what the reviewer asked for: a revision somebody already turned down,
 * a proposal to remove the page, and one with no data to apply. Edge
 * revisions never belong to a node in the first place.
 */
export function latestPublishableRevision<T extends RevisionCandidate>(
  revisions: T[],
): T | null {
  const usable = revisions.filter((revision) => {
    const data = revision.data as Record<string, unknown> | undefined | null;
    if (!data || typeof data !== "object") return false;
    if (data.deleted) return false;
    if (revision.status === "rejected") return false;
    return revisionCollection(revision) === "nodes";
  });

  // Ties broken by id so that two revisions written in the same millisecond -
  // an ingest writing a batch - resolve to the same one on both sides.
  const sorted = [...usable].sort((a, b) => {
    const timeA = normalizeUpdateTime(a.update_time) ?? "";
    const timeB = normalizeUpdateTime(b.update_time) ?? "";
    if (timeA !== timeB) return timeA < timeB ? 1 : -1;
    return b.id.localeCompare(a.id);
  });

  return sorted[0] ?? null;
}
