import { createRequire } from "node:module";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

/**
 * Gives back their Polish letters to the article names that lost them.
 *
 * `getPageMeta` read every page it fetched as UTF-8, so on a page in ISO-8859-2
 * each Polish letter of the title became U+FFFD, and the title was stored like
 * that as the article's name - "�winouj�cie - iswinoujscie.pl » Dariusz Bielski
 * dzi�kuje wszystkim wyborcom" on Dariusz Bielski's page
 * (https://koryta.pl/admin/opinie#fb-3qIISyfU0iXo0Sus5bgJ). Against the
 * production export of 2026-09-29, 4 of 663 article nodes carry U+FFFD in their
 * name, and nothing else in the database carries it anywhere but their
 * revisions:
 *
 *     3  iswinoujscie.pl         ISO-8859-2, declared only in a <meta http-equiv>
 *     1  wybory2001.pkw.gov.pl   ISO-8859-2, declared nowhere
 *
 * All four were added from a note's source, the path that asks `getPageMeta`
 * for the title (app/composables/articles.ts). The cause is fixed there: the
 * function now reads the body as bytes and decodes it in the page's own charset
 * (`readPage` in functions/src/pageMeta.ts, `decodePage` in
 * shared/pageEncoding.ts). The stored names cannot be repaired from what is
 * stored - the letters are gone - so this fetches each page again and reads its
 * title the same way a newly added article now gets one.
 *
 * The new title is written only when it has no U+FFFD of its own, when it
 * says what the stored one said wherever the stored one is still legible - the
 * two must agree once every character outside ASCII is set aside - and when
 * what it puts in place of the lost characters is Polish: letters with
 * diacritics, or „ ” – — and the like. A page that now answers with some other
 * title - moved, taken down, behind a consent wall - or one read in the wrong
 * single-byte encoding ("¦winouj¶cie") is listed and left alone, rather than
 * renaming the article after whatever is at the address today.
 *
 * So is an article with a proposal still waiting for review
 * (`revisions.has_unapproved`). This writes an approved revision over it, and
 * approving the proposal afterwards would write the garbled name back.
 *
 * Written as a revision, like backfill-article-dates.ts and for the same
 * reason: `name` is revision-carried data, and a bare field write would leave
 * the node disagreeing with its approved revision.
 *
 * `readPage` parses with cheerio, a dependency of `functions/` and not of the
 * app, so this needs `npm ci` in functions/ first - the same install the
 * functions deploy needs. Run it after that deploy: an article added before it
 * would come in garbled again, and would need this run a second time.
 *
 * Signed-in readers see the new names at once. Anonymous ones are served
 * `/api/nodes/[id]/mentions` from Nitro's cache for up to 6 hours, unless it
 * is cleared.
 *
 * Usage (against a running emulator):
 *   npx tsx scripts/migrate/refetch-garbled-article-titles.ts              # dry run
 *   npx tsx scripts/migrate/refetch-garbled-article-titles.ts --commit
 * Against production:
 *   npx tsx scripts/migrate/refetch-garbled-article-titles.ts --prod           # dry run
 *   npx tsx scripts/migrate/refetch-garbled-article-titles.ts --prod --commit
 */

/** `functions/` is a CommonJS package, so its module is required rather than
 * imported: an `import` of it from here finds no named exports. */
const require = createRequire(import.meta.url);
const { readPage } =
  require("../../functions/src/pageMeta") as typeof import("../../functions/src/pageMeta");

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

const REPLACEMENT = "\uFFFD";
/** Two writes per article - the revision, and the node pointing at it. */
const BATCH_SIZE = 400;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 15_000;
/** The one `getPageMeta` sends, so each page answers as it did then. */
const USER_AGENT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const AUTHOR = "migration:refetch-garbled-article-titles";

/** Kept in step with `INTERNAL_FIELDS` in server/utils/revisions.ts, which
 * this script cannot import: that module resolves `~~/` aliases that tsx does
 * not know about outside the Nuxt build. */
const INTERNAL_FIELDS = new Set([
  "stats",
  "revision_id",
  "published",
  "revisions",
  "votes",
  "id",
  "deleted",
  "delete_reason",
  "visibility",
  "merged_into",
  "needs_split",
  "nameChunksLower",
]);

/** What a garbled title still says: everything but the characters that were
 * lost and the ones that could have been. A byte UTF-8 could not read became
 * U+FFFD, or now and then some other character outside ASCII, but never an
 * ASCII one - and it never swallowed one - so the same title read again off
 * the same page reduces to exactly this. */
const legible = (title: string) => title.replace(/[^\p{ASCII}]/gu, "");

/** What may stand where the stored title has lost a character: Polish letters
 * and the punctuation Polish titles use. Anything else - `¦` for Ś, `¶` for ś -
 * is a page read in the wrong encoding. */
const POLISH = new Set("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ„”“‚’‘–—…«»·\u00a0".split(""));

/** The characters outside ASCII in `title` that `stored` does not have. */
function gained(stored: string, title: string): string[] {
  const left = [...stored];
  const extra: string[] = [];
  for (const char of title) {
    if (/\p{ASCII}/u.test(char)) continue;
    const at = left.indexOf(char);
    if (at >= 0) left.splice(at, 1);
    else extra.push(char);
  }
  return extra;
}

interface Candidate {
  id: string;
  name: string;
  sourceURL: string;
  /** Fields to carry into the revision - everything but the node's own
   * bookkeeping. */
  revisionData: Record<string, unknown>;
}

type Outcome =
  | { kind: "read"; title: string; encoding: string; source: string }
  | { kind: "failed"; reason: string };

async function readTitle(url: string): Promise<Outcome> {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const response = await fetch(target, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { kind: "failed", reason: `HTTP ${response.status}` };
    }
    const page = readPage(
      new Uint8Array(await response.arrayBuffer()),
      response.headers.get("content-type") ?? undefined,
    );
    return {
      kind: "read",
      title: page.title,
      encoding: page.encoding,
      source: page.encodingSource,
    };
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Runs `worker` over `items`, `CONCURRENCY` of them at a time. */
async function mapLimit<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    async () => {
      let index = next++;
      while (index < items.length) {
        results[index] = await worker(items[index]!);
        index = next++;
      }
    },
  );
  await Promise.all(runners);
  return results;
}

/** Why a page's title is not one to store, or undefined when it is. */
function refusal(stored: string, title: string): string | undefined {
  if (!title) return "the page has no title";
  if (title.includes(REPLACEMENT)) {
    return "the page's title still has U+FFFD in it";
  }
  if (legible(title) !== legible(stored)) {
    return "the page's title is not the one stored";
  }
  const foreign = gained(stored, title).filter((char) => !POLISH.has(char));
  if (foreign.length > 0) {
    return `the page's title has ${foreign.join("")} where Polish letters were lost`;
  }
  return undefined;
}

async function migrate() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  const snap = await db
    .collection("nodes")
    .where("type", "==", "article")
    .get();

  const candidates: Candidate[] = [];
  let setAside = 0;
  const awaitingReview: { id: string; name: string }[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (typeof data.name !== "string" || !data.name.includes(REPLACEMENT)) {
      continue;
    }
    // Nobody reads a removed or merged-away page under its own name.
    if (data.deleted === true || data.merged_into) {
      setAside += 1;
      continue;
    }
    if (typeof data.sourceURL !== "string" || !data.sourceURL) {
      setAside += 1;
      continue;
    }
    // A proposal waiting for review would, once approved, write the garbled
    // name back over this revision. Review it first, then run this again.
    if (data.revisions?.has_unapproved === true) {
      awaitingReview.push({ id: doc.id, name: data.name });
      continue;
    }
    const revisionData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!INTERNAL_FIELDS.has(key)) revisionData[key] = value;
    }
    candidates.push({
      id: doc.id,
      name: data.name,
      sourceURL: data.sourceURL,
      revisionData,
    });
  }

  console.log(
    `Read ${snap.size} article nodes: ${candidates.length} with U+FFFD in the ` +
      `name to read again` +
      (setAside
        ? `, ${setAside} more removed, merged away or without a url, left alone`
        : ""),
  );
  if (awaitingReview.length > 0) {
    console.log(
      `\n${awaitingReview.length} left alone because a proposal is waiting for review ` +
        `on /admin/rewizje - review it, then run this again:`,
    );
    for (const { id, name } of awaitingReview) console.log(`  ${id}  ${name}`);
  }
  if (candidates.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  console.log(
    `\nFetching ${candidates.length} page(s), ${CONCURRENCY} at a time…`,
  );
  const outcomes = await mapLimit(candidates, (candidate) =>
    readTitle(candidate.sourceURL),
  );

  const writes: { candidate: Candidate; title: string; how: string }[] = [];
  const skipped: { candidate: Candidate; reason: string; title?: string }[] =
    [];
  for (const [index, candidate] of candidates.entries()) {
    const outcome = outcomes[index]!;
    if (outcome.kind === "failed") {
      skipped.push({ candidate, reason: outcome.reason });
      continue;
    }
    const reason = refusal(candidate.name, outcome.title);
    if (reason) {
      skipped.push({ candidate, reason, title: outcome.title });
      continue;
    }
    writes.push({
      candidate,
      title: outcome.title,
      how: `${outcome.encoding}, ${outcome.source}`,
    });
  }

  console.log(
    `\n${writes.length} to rename, ${skipped.length} left as they are.`,
  );
  for (const { candidate, title, how } of writes) {
    console.log(`\n  ${candidate.id}  ${candidate.sourceURL}  (${how})`);
    console.log(`      was  ${candidate.name}`);
    console.log(`      now  ${title}`);
  }
  if (skipped.length > 0) {
    console.log("\nLeft as they are:");
    for (const { candidate, reason, title } of skipped) {
      console.log(`\n  ${candidate.id}  ${candidate.sourceURL}  (${reason})`);
      console.log(`      stored  ${candidate.name}`);
      if (title) console.log(`      page    ${title}`);
    }
  }

  if (!commit) {
    console.log("\nDry run — nothing written.");
    return;
  }

  let batch = db.batch();
  let pending = 0;
  let done = 0;
  for (const { candidate, title } of writes) {
    const revisionRef = db.collection("revisions").doc();
    const now = Timestamp.now();
    batch.set(revisionRef, {
      node_id: candidate.id,
      collection: "nodes",
      data: { ...candidate.revisionData, name: title },
      update_time: now,
      update_user: AUTHOR,
      update_automatic: true,
      // Written already reviewed, and pointed at below, so `computeRevisionsObj`
      // does not read the node as having a change still waiting for approval.
      status: "approved",
      review_user: AUTHOR,
      review_time: now,
    });
    batch.update(db.collection("nodes").doc(candidate.id), {
      name: title,
      revision_id: revisionRef,
    });

    pending += 2;
    done += 1;
    if (pending >= BATCH_SIZE) {
      await batch.commit();
      console.log(`committed ${done}/${writes.length}`);
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  console.log(`\n${done} article(s) renamed. Done.`);
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
