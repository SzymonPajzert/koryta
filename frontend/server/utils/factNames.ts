/** The names in the article facts that no page carries, held in memory.
 *
 * Built from a read of the facts, not asked of Firestore per search: there is
 * no index to ask. A fact carries names in three fields, spelled however the
 * article spelled them, and the one field that is resolved - `personNodeId` -
 * is the subject, the one name this is not about. Writing name chunks onto
 * every fact instead would give each keystroke of the search box a Firestore
 * query of its own; this gives an instance one read when it first gets a
 * signed in search, another once `INDEX_TTL_MS` has passed if it is still
 * getting them, and every search in between costs nothing.
 *
 * The read is narrowed to the facts that can name somebody unmatched, which is
 * a small slice of the collection: on the 2026-09-29 export, 337 relations and
 * 861 facts whose subject matched nobody, 1,117 documents between them out of
 * 15,423. The rest name only their subject, and it was matched to a page. On
 * top of those, one read per page the facts link to (142) and the check for
 * names that have a page (17 queries, 119 nodes): ~1,480 reads a build. */

import type { Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/logger";
import {
  buildFactNameIndex,
  candidateSpellings,
  factNameKey,
  type FactNameEntry,
  type FactNameSource,
} from "~~/shared/factNames";

/** How long an instance serves an index before reading it again.
 *
 * Long, because it only changes when facts are ingested - a few batches a
 * week - and the ingest forgets the copy on the instance that handled it
 * (`forgetFactNameIndex`). Each instance holds its own, like every other cache
 * here (Nitro's store is in memory), and prod ran 23 of them at its peak: a
 * short lifetime would multiply the read by every one of them. */
const INDEX_TTL_MS = 12 * 60 * 60_000;

/** How soon a rebuild that failed is tried again. The stale index is served
 * meanwhile; retrying on every search would read the facts again each time. */
const RETRY_MS = 10 * 60_000;

/** The fields read per fact - what `FactNameSource` needs, and nothing else.
 * A field mask does not make a document cheaper to read, but it keeps the
 * justifications, which are most of a fact's bytes, off the wire. */
const FACT_FIELDS = [
  "fact_type",
  "person",
  "subject",
  "object",
  "personNodeId",
  "personNodeName",
  "articleUrl",
  "articleDomain",
] as const;

/** `array-contains-any` takes at most thirty values. */
const CHUNKS_PER_QUERY = 30;

let cached: { builtAt: number; index: Promise<FactNameEntry[]> } | null = null;
let rebuilding = false;
/** When the last build with nothing to fall back on failed. */
let failedAt: number | null = null;
/** Bumped by `forgetFactNameIndex`, so that a rebuild which started before an
 * ingest cannot put its older answer back once it lands. */
let generation = 0;

/** Drop this instance's copy, so the next search reads the facts again. For
 * the ingest, after it writes, and for tests. */
export function forgetFactNameIndex(): void {
  cached = null;
  failedAt = null;
  generation++;
}

/** The index, read once per instance and then served from memory.
 *
 * Past `INDEX_TTL_MS` the old one goes on being served while a new one is
 * read, so no search waits for the read except the first on an instance.
 */
export function factNameIndex(db: Firestore): Promise<FactNameEntry[]> {
  if (!cached) {
    // A first build that failed has no old index to serve instead. Trying it
    // again on the next search would read the facts once per keystroke for as
    // long as whatever broke stays broken, so for `RETRY_MS` there are no
    // names from the facts at all - the people search above does not mind.
    if (failedAt !== null && Date.now() - failedAt < RETRY_MS) {
      return Promise.resolve([]);
    }
    const index = readFactNameIndex(db);
    const entry = { builtAt: Date.now(), index };
    cached = entry;
    index.then(
      () => {
        failedAt = null;
      },
      (error: unknown) => {
        logger.error("Could not build the fact name index", { error });
        if (cached === entry) {
          cached = null;
          failedAt = Date.now();
        }
      },
    );
    return index;
  }

  if (!rebuilding && Date.now() - cached.builtAt > INDEX_TTL_MS) {
    rebuilding = true;
    const started = generation;
    const current = cached;
    const next = readFactNameIndex(db);
    next
      .then(
        () => {
          if (generation === started) {
            cached = { builtAt: Date.now(), index: next };
          }
        },
        (error: unknown) => {
          logger.error("Could not rebuild the fact name index", { error });
          current.builtAt = Date.now() - INDEX_TTL_MS + RETRY_MS;
        },
      )
      .finally(() => {
        rebuilding = false;
      });
  }
  return cached.index;
}

/** Everything the index is built from, read and assembled.
 *
 * Two queries rather than one, because `personMatched` only exists on facts
 * ingested since this was written until `scripts/migrate/backfill-person-
 * matched.ts` has run: a relation is found by its type whether or not it
 * carries the flag, so the other person in one - the reason this exists - is
 * searchable from the first deploy. A relation whose subject matched nobody
 * comes back from both, and is read twice; there were 81 of those.
 */
async function readFactNameIndex(db: Firestore): Promise<FactNameEntry[]> {
  const facts = db.collection("extractions");
  const [relations, unmatched] = await Promise.all([
    facts
      .where("fact_type", "==", "personal_relation")
      .select(...FACT_FIELDS)
      .get(),
    facts
      .where("personMatched", "==", false)
      .select(...FACT_FIELDS)
      .get(),
  ]);

  const byId = new Map<string, FactNameSource>();
  for (const doc of [...relations.docs, ...unmatched.docs]) {
    byId.set(doc.id, doc.data() as FactNameSource);
  }
  const sources = [...byId.values()];

  const [taken, pages] = await Promise.all([
    namesWithPages(db, candidateSpellings(sources)),
    subjectPages(db, sources),
  ]);
  return buildFactNameIndex(sources, taken, pages);
}

/** `getAll` is one round trip; chunked, as the ingest's own lookup is. */
const PAGES_PER_READ = 300;

/** What the graph says today about the subjects these facts were matched to:
 * each page's current name, or null for one that is gone.
 *
 * The facts store the name their subject had at ingest, and a link built from
 * it goes through a slug redirect once the page is renamed; a page removed
 * since, or merged into another as a duplicate, is not somewhere to send a
 * reader at all - its fact falls back to its article. An unpublished page
 * stays: a signed in reader, the only one who sees these names, is shown it
 * and its facts, as they are on /ekstrakcje.
 *
 * One read per distinct subject, field-masked - 142 on the 2026-09-29 export.
 */
async function subjectPages(
  db: Firestore,
  facts: FactNameSource[],
): Promise<Map<string, string | null>> {
  const ids = [
    ...new Set(
      facts.map((fact) => fact.personNodeId).filter((id): id is string => !!id),
    ),
  ];
  const pages = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += PAGES_PER_READ) {
    const refs = ids
      .slice(i, i + PAGES_PER_READ)
      .map((id) => db.collection("nodes").doc(id));
    const docs = await db.getAll(...refs, {
      fieldMask: ["name", "type", "deleted", "merged_into"],
    });
    for (const doc of docs) {
      const node = doc.data();
      const live =
        node &&
        node.type === "person" &&
        node.deleted !== true &&
        !node.merged_into &&
        typeof node.name === "string";
      pages.set(doc.id, live ? (node.name as string) : null);
    }
  }
  return pages;
}

/** The keys of the names somebody already has a page under.
 *
 * Asked of the search index the people search uses, `nameChunksLower`, which
 * carries each node's whole name lowercased: thirty names a query, and a query
 * reads only the nodes whose name starts with one of them. On the 2026-09-29
 * export that is 482 spellings, seventeen queries and 119 nodes read, 90 of
 * the names taken. What comes back is compared the way the facts are keyed, so
 * „Jan Kowalski-Nowak” does not take „Jan Kowalski” with it.
 *
 * A person only, and a live one: a page merged into another is not somebody's
 * page any more, and its name lives on under the survivor.
 */
async function namesWithPages(
  db: Firestore,
  spellings: string[],
): Promise<Set<string>> {
  const chunks = [
    ...new Set(
      spellings.map((name) => name.trim().replace(/\s+/g, " ").toLowerCase()),
    ),
  ];
  const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
  for (let i = 0; i < chunks.length; i += CHUNKS_PER_QUERY) {
    queries.push(
      db
        .collection("nodes")
        .where(
          "nameChunksLower",
          "array-contains-any",
          chunks.slice(i, i + CHUNKS_PER_QUERY),
        )
        .select("name", "type", "deleted")
        .get(),
    );
  }

  const taken = new Set<string>();
  for (const snapshot of await Promise.all(queries)) {
    for (const doc of snapshot.docs) {
      const node = doc.data();
      if (node.type !== "person" || node.deleted === true) continue;
      if (typeof node.name === "string") taken.add(factNameKey(node.name));
    }
  }
  return taken;
}
