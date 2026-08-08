/** A page captured from someone's browser, and what came of it.
 *
 * The crawler cannot read an article behind a paywall — it fetches anonymously,
 * and gets the teaser. A reader who is logged in already has the whole thing
 * rendered in front of them, so the capture path takes the DOM they are looking
 * at, files it in the crawled bucket exactly where the crawler would have put
 * it, and runs the article pipeline's extraction over it straight away.
 */

/** How far a capture has got.
 *
 * `stored` means the html is in the bucket and nothing has read it yet — which
 * is already useful on its own, because the nightly pipeline will pick it up
 * from `url_store` whatever the fast path does.
 */
export type CaptureStatus = "stored" | "extracting" | "done" | "error";

export type CaptureSource = "extension" | "paste";

export interface CaptureExtraction {
  /** Which run produced these facts, in the same namespace as
   * `ExtractionFact.tag` — so facts from the fast path are told apart from the
   * nightly batch's, which uses a different model. */
  tag: string;
  model?: string;
  promptVersion?: number;
  /** How many facts survived verification and were submitted. */
  factCount?: number;
  /** The article pipeline's 0-5 koryciarski score, kept for context. Null when
   * the model judged the page not to be an article at all. */
  koryciarskiScore?: number | null;
  koryciarskiReason?: string;
  /** Set only on `status: "error"`. */
  error?: string | null;
  startedAt?: string;
  finishedAt?: string;
}

export interface ArticleCapture {
  id: string;
  /** The url as captured, scheme and all. Everything downstream — the bucket
   * path, the tar member, the `url_store` row — is derived from this one
   * string, so it is stored verbatim rather than rebuilt. */
  url: string;
  /** `normalizeUrl(url)`, which is what joins a capture to an article node and
   * to the facts extracted from it. */
  normalizedUrl: string;
  domain: string;
  title: string | null;
  articleNodeId?: string;
  /** `gs://koryta-pl-crawled/hostname=…/date=…/uid_….tar.gz` */
  storagePath: string;
  htmlSha256: string;
  htmlBytes: number;
  source: CaptureSource;
  status: CaptureStatus;
  capturedBy: string;
  capturedAt: string;
  updatedAt: string;
  extraction?: CaptureExtraction;
}

/** The tag the fast path stamps its facts with.
 *
 * Versioned separately from the batch pipeline's `--tag`: the two run different
 * models over the same prompts, and a reviewer sorting through
 * `/ekstrakcje` should be able to tell which one guessed. */
export const CAPTURE_EXTRACTION_TAG = "capture_v1";

/** Cap on a single captured page, before compression.
 *
 * News pages with their scripts inlined reach a couple of megabytes; past this
 * it is not an article, and the extension is sending the wrong thing. */
export const MAX_CAPTURE_HTML_BYTES = 8 * 1024 * 1024;
