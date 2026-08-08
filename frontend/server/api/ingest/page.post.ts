import { gunzipSync } from "node:zlib";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { ensureArticleNode } from "~~/server/utils/articles";
import {
  parseCrawlUrl,
  sha256,
  uploadCapturedPage,
} from "~~/server/utils/crawledBucket";
import { dispatchExtraction } from "~~/server/utils/extractor";
import { normalizeUrl } from "~~/shared/url";
import { MAX_CAPTURE_HTML_BYTES } from "~~/shared/capture";

const pageRequestSchema = z.object({
  url: z.string().min(1),
  /** The rendered DOM. Base64 either way; `gzip` is what the extension sends,
   * which takes a 2 MB news page down to something like 300 KB. */
  html: z.string().min(1),
  htmlEncoding: z.enum(["base64", "gzip-base64"]).default("gzip-base64"),
  title: z.string().nullable().optional(),
  publishedDate: z.string().optional(),
  meta: z.any().optional(),
  source: z.enum(["extension", "paste"]).default("extension"),
});

function decodeHtml(body: z.infer<typeof pageRequestSchema>): Buffer {
  const raw = Buffer.from(body.html, "base64");
  if (raw.length === 0) {
    throw createError({ statusCode: 422, message: "Pusta treść strony." });
  }

  let html: Buffer;
  try {
    html = body.htmlEncoding === "gzip-base64" ? gunzipSync(raw) : raw;
  } catch {
    throw createError({
      statusCode: 422,
      message: "Nie udało się rozpakować treści strony.",
    });
  }

  if (html.length > MAX_CAPTURE_HTML_BYTES) {
    throw createError({
      statusCode: 413,
      message: `Strona jest za duża (${html.length} B).`,
    });
  }
  return html;
}

/** Takes a page someone was reading and files it where the crawler would have.
 *
 * The point is the paywall: `getPageMeta` and the crawler both fetch anonymously
 * and get a teaser, while the reader's own browser has the article rendered.
 * What arrives here is that DOM, which is stored as a one-page archive in the
 * crawled bucket, registered as an article node, and handed to the extractor.
 *
 * Restricted to the datascience group, the same gate `/api/ingest/extraction`
 * uses: this writes to the shared bucket, spends LLM calls, and puts facts in
 * front of reviewers, none of which is open to every signed-in account.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    pageRequestSchema.parse(body),
  );
  const user = requireDatascience(await getUser(event));
  const html = decodeHtml(body);

  // Throws a 422 on a url the crawled-bucket layout cannot be built from,
  // before anything has been written.
  const { hostname, full } = parseCrawlUrl(body.url);
  const url = full;
  const normalizedUrl = normalizeUrl(url);

  const db = getFirestore(getApp(), "koryta-pl");
  const htmlSha256 = sha256(html);

  // Re-submitting the same bytes is a no-op rather than a second job: the
  // extension's popup retries, and a browser that reloads mid-upload sends the
  // page twice. Keyed on the content hash, so a genuinely updated page — or a
  // capture that got further past the paywall — still gets its own run.
  //
  // Checked before the upload, not after: the archive name carries a fresh uuid
  // every time, so uploading first would leave an orphan copy in the bucket for
  // every retry, with nothing pointing at it.
  const duplicate = await db
    .collection("articlePages")
    .where("normalizedUrl", "==", normalizedUrl)
    .where("htmlSha256", "==", htmlSha256)
    .limit(1)
    .get();
  if (!duplicate.empty) {
    const doc = duplicate.docs[0]!;
    return {
      status: "ok",
      pageId: doc.id,
      duplicate: true,
      captureStatus: doc.data().status,
      articleNodeId: doc.data().articleNodeId,
      storagePath: doc.data().storagePath,
    };
  }

  const { storagePath } = await uploadCapturedPage({ url, html });

  const batch = db.batch();
  const { nodeId, created } = await ensureArticleNode(db, batch, user, {
    url,
    // Titles come from the page's own `<title>`/ld+json; a page that reached
    // here with neither still deserves a node, named after the url.
    name: body.title?.trim() || url,
    publishedDate: body.publishedDate,
    meta: body.meta,
  });

  const now = Timestamp.now();
  const pageRef = db.collection("articlePages").doc();
  batch.set(pageRef, {
    url,
    normalizedUrl,
    domain: hostname,
    title: body.title?.trim() || null,
    articleNodeId: nodeId,
    storagePath,
    htmlSha256,
    htmlBytes: html.length,
    source: body.source,
    status: "stored",
    capturedBy: user.uid,
    capturedAt: now,
    updatedAt: now,
  });
  await batch.commit();

  const { dispatched, error } = await dispatchExtraction({
    pageId: pageRef.id,
    url,
    storagePath,
    htmlSha256,
    uploaderUid: user.uid,
    articleNodeId: nodeId,
  });

  // A capture that could not be handed to the extractor is still stored, and
  // the nightly pipeline reads it out of the bucket regardless — so this is
  // recorded on the document rather than raised at the caller, who has nothing
  // useful to do about it.
  if (!dispatched) {
    await pageRef.update({
      status: "error",
      updatedAt: Timestamp.now(),
      "extraction.error": error ?? "extraction was not dispatched",
    });
  }

  return {
    status: "ok",
    pageId: pageRef.id,
    duplicate: false,
    captureStatus: dispatched ? "stored" : "error",
    articleNodeId: nodeId,
    articleNodeCreated: created,
    storagePath,
    dispatched,
  };
});
