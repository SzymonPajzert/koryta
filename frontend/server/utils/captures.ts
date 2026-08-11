import type { Timestamp } from "firebase-admin/firestore";
import type { ArticleCapture } from "~~/shared/capture";

function iso(value: unknown): string {
  if (value && typeof (value as Timestamp).toDate === "function") {
    return (value as Timestamp).toDate().toISOString();
  }
  return typeof value === "string" ? value : "";
}

/** A stored capture in the shape the client reads.
 *
 * Timestamps become ISO strings here rather than crossing as Firestore's
 * `{_seconds}` shape, which `/zrodla` already has one workaround for and does
 * not need a second of.
 */
export function toArticleCapture(
  id: string,
  data: FirebaseFirestore.DocumentData,
): ArticleCapture {
  return {
    id,
    url: String(data.url ?? ""),
    normalizedUrl: String(data.normalizedUrl ?? ""),
    domain: String(data.domain ?? ""),
    title: data.title ?? null,
    articleNodeId: data.articleNodeId ?? undefined,
    storagePath: String(data.storagePath ?? ""),
    htmlSha256: String(data.htmlSha256 ?? ""),
    htmlBytes: Number(data.htmlBytes ?? 0),
    selection: data.selection ?? null,
    source: data.source === "paste" ? "paste" : "extension",
    status: data.status ?? "stored",
    capturedBy: String(data.capturedBy ?? ""),
    capturedAt: iso(data.capturedAt),
    updatedAt: iso(data.updatedAt),
    extraction: data.extraction
      ? {
          ...data.extraction,
          startedAt: data.extraction.startedAt
            ? iso(data.extraction.startedAt)
            : undefined,
          finishedAt: data.extraction.finishedAt
            ? iso(data.extraction.finishedAt)
            : undefined,
        }
      : undefined,
  };
}
