import type {
  DocumentData,
  DocumentSnapshot,
  Firestore,
} from "firebase-admin/firestore";
import { warsawDate } from "~~/shared/dates";
import {
  arrivedSince,
  countPeople,
  cropRecordOf,
  factsByPage,
  indexCrops,
  isPersonPage,
  isPublicationStatus,
  millisOf,
  namedElsewhere,
  pageBirthDate,
  pagesNamedBy,
  peopleSnapshot,
  personEntrySchema,
  publicOtherwise,
  stagePerson,
  type CropRecord,
  type PageNode,
  type PageState,
  type PersonEntry,
  type PublicationState,
} from "~~/shared/declarationPeople";
import {
  declarationPeopleSchema,
  peopleStages,
  type DeclarationFactsIngest,
  type DeclarationFactsResult,
  type DeclarationPeople,
  type PeopleStage,
} from "~~/shared/declarations";
import { PEOPLE_DOC } from "./declarationPeople";
import { EXTRACTS, PUBLICATIONS } from "./declarations";
import { chunksOf, inParallel } from "./parallel";
import { pagesWithAPublicPost } from "./publicPosts";

/**
 * The people snapshot, counted on the site (decision on 2026-11-17): whole
 * from the facts the night sends (`countDeclarationPeople`), and for the
 * people a daytime event touches (`restageDeclarationPeople`): a reading
 * settles, a page is published or held, an admin decides a crop, an upload
 * brings crops. The rules are shared/declarationPeople.ts.
 *
 * Each counted person's entry is kept in `declarationPeople/shard-<n>`, what
 * re-staging them needs; the snapshot is derived from all of them into
 * `stats/declaration_people`, which the GET reads. Server only: no client
 * reads `declarationPeople` (firestore.rules). Nothing queries the entries,
 * so they are kept out of every index (firestore.indexes.json): indexed, a
 * person costs about 20 of a document's 40,000 index entries.
 *
 * The night counts on autopush, and readers and admins move people on prod
 * too, each on its own release. Re-staging writes nothing while any entry
 * does not read under this release's strict schema: it would rewrite the
 * shards and the snapshot without them. The next count writes them all.
 */

export const DECLARATION_PEOPLE = "declarationPeople";
const PEOPLE_META = "meta";
const PEOPLE_SHARDS = 8;

/** How far `merged_into` is followed, as `resolveMergedNode` does. */
const MERGE_HOPS = 8;
const GET_ALL_CHUNK = 100;
/** Requests in flight at once. */
const IN_PARALLEL = 8;
/** Firestore's cap on the values of an `array-contains-any`. */
const ANY_CHUNK = 30;

const NODE_FIELDS = ["type", "published", "birthDate", "merged_into"];
const PUBLICATION_FIELDS = ["personId", "status", "reason", "publishedAt"];
const CROP_FIELDS = [
  "status",
  "personIds",
  "pageOutcomes",
  "agreed.value",
  "candidacyKeys",
  "createdAt",
];

/** The shard a page's entry is kept in: FNV-1a of its id, the same on every
 * instance and release. */
export function shardOf(pageId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < pageId.length; i++) {
    hash ^= pageId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % PEOPLE_SHARDS;
}

function refsOf(db: Firestore) {
  const people = db.collection(DECLARATION_PEOPLE);
  return {
    meta: people.doc(PEOPLE_META),
    shards: Array.from({ length: PEOPLE_SHARDS }, (_, i) =>
      people.doc(`shard-${i}`),
    ),
    stats: db.collection("stats").doc(PEOPLE_DOC),
  };
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function mergedInto(node: DocumentData | null | undefined): string | null {
  const next = node?.merged_into;
  return typeof next === "string" && next ? next : null;
}

/** The entries a shard holds, and how many do not read as one. */
function entriesOf(data: DocumentData | undefined): {
  entries: [string, PersonEntry][];
  unread: number;
} {
  const stored: unknown = data?.entries;
  const entries: [string, PersonEntry][] = [];
  let unread = 0;
  if (stored && typeof stored === "object") {
    for (const [page, raw] of Object.entries(stored)) {
      const parsed = personEntrySchema.safeParse(raw);
      if (parsed.success) entries.push([page, parsed.data]);
      else unread += 1;
    }
  }
  return { entries, unread };
}

/** The shards' entries, for a re-staging to rewrite: none at all if one does
 * not read (see the top of this file). */
function readShards(
  shards: readonly DocumentSnapshot[],
): Map<string, PersonEntry>[] {
  return shards.map((shard) => {
    const { entries, unread } = entriesOf(shard.data());
    if (unread > 0) {
      throw new Error(
        `${unread} people entries in ${shard.id} do not read; left for the night's count`,
      );
    }
    return new Map(entries);
  });
}

/** The entries by shard, as each shard document is written. */
function shardData(
  entries: Iterable<readonly [string, PersonEntry]>,
): { entries: Record<string, PersonEntry> }[] {
  const shards = Array.from({ length: PEOPLE_SHARDS }, () => ({
    entries: {} as Record<string, PersonEntry>,
  }));
  for (const [page, entry] of entries) {
    shards[shardOf(page)]!.entries[page] = entry;
  }
  return shards;
}

type ResolvedPage = { id: string; node: DocumentData | undefined };

/** Each id's page followed through merges, as `resolveMergedNode` follows it,
 * with the final node's `fields`: a hop at a time for all of them at once,
 * `getAll` a hundred at a time. A page that is gone resolves to itself with
 * no node. */
async function resolvePages(
  db: Firestore,
  ids: Iterable<string>,
  fields: readonly string[],
): Promise<Map<string, ResolvedPage>> {
  const wanted = unique(ids);
  const nodes = new Map<string, DocumentData | null>();
  const fieldMask = unique([...fields, "merged_into"]);
  let next = wanted;
  for (let hop = 0; hop <= MERGE_HOPS && next.length > 0; hop++) {
    await inParallel(
      chunksOf(next, GET_ALL_CHUNK),
      IN_PARALLEL,
      async (chunk) => {
        const snapshots = await db.getAll(
          ...chunk.map((id) => db.collection("nodes").doc(id)),
          { fieldMask },
        );
        for (const snapshot of snapshots) {
          nodes.set(snapshot.id, snapshot.exists ? snapshot.data()! : null);
        }
      },
    );
    next = unique(
      next.flatMap((id) => {
        const target = mergedInto(nodes.get(id));
        return target && !nodes.has(target) ? [target] : [];
      }),
    );
  }
  const resolved = new Map<string, ResolvedPage>();
  for (const id of wanted) {
    let current = id;
    const seen = new Set([id]);
    for (let hop = 0; hop < MERGE_HOPS; hop++) {
      const target = mergedInto(nodes.get(current));
      // A cycle stops at the page it was reached from.
      if (!target || seen.has(target)) break;
      seen.add(target);
      current = target;
    }
    resolved.set(id, { id: current, node: nodes.get(current) ?? undefined });
  }
  return resolved;
}

/** The Warsaw day of a stored instant: a Timestamp, a Date or ISO text. */
function warsawDayOf(value: unknown): string | null {
  const ms = millisOf(value);
  return ms === null ? null : warsawDate(new Date(ms));
}

function publicationOf(
  data: DocumentData | undefined,
): PublicationState | null {
  const status = data?.status;
  if (!isPublicationStatus(status)) return null;
  return {
    status,
    reason:
      typeof data?.reason === "string" && data.reason ? data.reason : null,
    publishedOn: warsawDayOf(data?.publishedAt),
  };
}

/** Whether the facts are older than the ones counted last, and not forced. */
function olderThanCounted(
  meta: DocumentData | undefined,
  body: Pick<DeclarationFactsIngest, "generation" | "force">,
): boolean {
  if (body.force) return false;
  const counted =
    typeof meta?.generation === "string" ? Date.parse(meta.generation) : NaN;
  return Number.isFinite(counted) && Date.parse(body.generation) < counted;
}

function refuseOlder(
  meta: DocumentData | undefined,
  body: DeclarationFactsIngest,
): void {
  if (olderThanCounted(meta, body)) {
    throw createError({
      statusCode: 409,
      statusMessage: "Conflict",
      message: `facts of ${body.generation} are older than the ones counted (${String(meta?.generation)}); send force to count them`,
    });
  }
}

/** A 409 for facts older than the ones counted last, before anything is
 * read. */
export async function refuseOlderFacts(
  db: Firestore,
  body: DeclarationFactsIngest,
): Promise<void> {
  refuseOlder((await refsOf(db).meta.get()).data(), body);
}

/**
 * Counts the people snapshot whole from the night's facts, and keeps each
 * person's entry for the re-staging during the day.
 *
 * Reads the list's pages (followed through merges), every publication record
 * and every crop, a few fields each, and which pages have a public post. The
 * writes are one transaction, which refuses facts older than the ones counted
 * meanwhile. A person re-staged while this read is re-staged again once it is
 * written: their entry was newer than the count.
 *
 * Runs inside the night's request, so it logs how long it took.
 */
export async function countDeclarationPeople(
  db: Firestore,
  body: DeclarationFactsIngest,
  now: Date,
): Promise<DeclarationFactsResult> {
  const started = Date.now();
  const [pages, publicationDocs, cropDocs] = await Promise.all([
    resolvePages(
      db,
      body.candidacies.flatMap((fact) => fact.kids),
      NODE_FIELDS,
    ),
    db
      .collection(PUBLICATIONS)
      .select(...PUBLICATION_FIELDS)
      .get(),
    db
      .collection(EXTRACTS)
      .select(...CROP_FIELDS)
      .get(),
  ]);
  const crops = cropDocs.docs.map((doc) => cropRecordOf(doc.data()));
  const recordPage = (doc: { id: string; get(field: string): unknown }) => {
    const personId = doc.get("personId");
    return typeof personId === "string" && personId ? personId : doc.id;
  };
  // Pages the crops and the records name that are no kid of the list: one
  // merged into a page of it is that page's.
  const others = await resolvePages(
    db,
    unique([
      ...crops.flatMap(pagesNamedBy),
      ...publicationDocs.docs.map(recordPage),
    ]).filter((id) => !pages.has(id)),
    [],
  );
  const resolve = (id: string) => pages.get(id)?.id ?? others.get(id)?.id ?? id;

  const nodes = new Map<string, PageNode>();
  for (const { id, node } of pages.values()) if (node) nodes.set(id, node);
  const publications = new Map<string, PublicationState>();
  for (const doc of publicationDocs.docs) {
    const state = publicationOf(doc.data());
    if (state) publications.set(resolve(recordPage(doc)), state);
  }
  const byPage = factsByPage(body.candidacies, resolve);
  const publicPosts = await pagesWithAPublicPost(
    db,
    [...byPage.keys()].filter((page) => isPersonPage(nodes.get(page))),
  );
  const counted = countPeople({
    byPage,
    nodes,
    publicPosts,
    publications,
    crops: indexCrops(crops, resolve),
    factsAt: Date.parse(body.partAt),
    now,
  });
  const snapshot = declarationPeopleSchema.parse(
    peopleSnapshot(counted.entries, now),
  );

  const refs = refsOf(db);
  const newer = await db.runTransaction(async (tx) => {
    const [meta, ...shards] = await tx.getAll(refs.meta, ...refs.shards);
    refuseOlder(meta?.data(), body);
    // One that does not read is written over like the rest.
    const restaged = shards.flatMap((shard) =>
      entriesOf(shard.data()).entries.flatMap(([page, entry]) =>
        entry.at > now.getTime() ? [page] : [],
      ),
    );
    tx.set(refs.meta, {
      generation: body.generation,
      listAt: body.listAt,
      part: body.part,
      partAt: body.partAt,
      countedAt: now.toISOString(),
      shards: PEOPLE_SHARDS,
    });
    shardData(counted.entries).forEach((data, i) => {
      tx.set(refs.shards[i]!, data);
    });
    tx.set(refs.stats, snapshot);
    return restaged;
  });
  console.info(
    `[declarations] counted ${snapshot.people} people from ${body.part} ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)} s; ` +
      `left out ${JSON.stringify(counted.leftOut)}`,
  );
  if (newer.length > 0) await restageDeclarationPeople(db, newer);

  return {
    status: "ok",
    people: snapshot.people,
    stages: Object.fromEntries(
      peopleStages.map((stage) => [stage, snapshot[stage]]),
    ) as Record<PeopleStage, number>,
    unknownReasons: counted.unknownReasons,
  };
}

/** What the site holds of the pages to re-stage: the crops by the pages they
 * name, and each page's node and publication record. Null for a page that
 * leaves the count; a page missing from the answer is left as it is.
 *
 * Crops are found by the page and by its candidacies, records by the page.
 * One kept under an id merged into the page since, sharing no candidacy with
 * it, waits for the night's count, which follows every merge: a page
 * published that way keeps its stage until then. */
async function readPages(
  db: Firestore,
  targets: ReadonlyMap<string, PersonEntry>,
  resolved: ReadonlyMap<string, ResolvedPage>,
  /** When predator wrote the facts the entries hold, in ms. */
  factsAt: number,
): Promise<Map<string, PageState | null>> {
  const pages = [...targets.keys()];
  const publications = new Map<string, PublicationState>();
  const crops = new Map<string, CropRecord>();
  const queries = [...targets].flatMap(([page, entry]) => [
    db.collection(EXTRACTS).where("personIds", "array-contains", page),
    ...chunksOf(entry.keys, ANY_CHUNK).map((keys) =>
      db
        .collection(EXTRACTS)
        .where("candidacyKeys", "array-contains-any", keys),
    ),
  ]);
  await Promise.all([
    inParallel(chunksOf(pages, GET_ALL_CHUNK), IN_PARALLEL, async (chunk) => {
      const docs = await db.getAll(
        ...chunk.map((page) => db.collection(PUBLICATIONS).doc(page)),
        { fieldMask: PUBLICATION_FIELDS },
      );
      for (const doc of docs) {
        const state = doc.exists ? publicationOf(doc.data()) : null;
        if (state) publications.set(doc.id, state);
      }
    }),
    inParallel(queries, IN_PARALLEL, async (query) => {
      const snapshot = await query.select(...CROP_FIELDS).get();
      for (const doc of snapshot.docs) {
        crops.set(doc.id, cropRecordOf(doc.data()));
      }
    }),
  ]);

  const nodes = new Map<string, DocumentData | undefined>();
  for (const { id, node } of resolved.values()) nodes.set(id, node);
  const others = await resolvePages(
    db,
    unique([...crops.values()].flatMap(pagesNamedBy)).filter(
      (id) => !resolved.has(id),
    ),
    [],
  );
  const resolve = (id: string) =>
    resolved.get(id)?.id ?? others.get(id)?.id ?? id;
  const index = indexCrops(crops.values(), resolve);

  const states = new Map<string, PageState | null>();
  for (const [page, entry] of targets) {
    const node = nodes.get(page);
    const publication = publications.get(page) ?? null;
    if (
      entry.stage === "published" &&
      node?.published === true &&
      publication === null
    ) {
      continue;
    }
    if (!isPersonPage(node) || publicOtherwise(node, publication)) {
      states.set(page, null);
      continue;
    }
    states.set(page, {
      publication,
      crops: index.byPage.get(page) ?? [],
      birthDate: pageBirthDate(node.birthDate),
      elsewhere: namedElsewhere(page, entry.keys, index),
      arrived: arrivedSince(entry.keys, index, factsAt),
    });
  }
  return states;
}

async function restage(
  db: Firestore,
  ids: readonly string[],
  now: Date,
): Promise<void> {
  const at = now.getTime();
  const refs = refsOf(db);
  const resolved = await resolvePages(db, ids, NODE_FIELDS);
  const finalOf = (id: string) => resolved.get(id)?.id ?? id;
  const wanted = unique(ids.flatMap((id) => [id, finalOf(id)]));
  const shardRefs = unique(wanted.map(shardOf)).map((i) => refs.shards[i]!);
  const [meta, ...shardDocs] = await db.getAll(refs.meta, ...shardRefs);
  // Nothing to move before the first count.
  if (!meta?.exists) return;
  const stored = new Map(readShards(shardDocs).flatMap((map) => [...map]));
  const partAt: unknown = meta.data()?.partAt;
  const factsAt = typeof partAt === "string" ? Date.parse(partAt) : NaN;

  // A page merged since the count is gone; the page it went into is
  // re-staged if it is counted.
  const gone = ids.filter((id) => finalOf(id) !== id && stored.has(id));
  const targets = new Map<string, PersonEntry>();
  for (const id of ids) {
    const entry = stored.get(finalOf(id));
    if (entry) targets.set(finalOf(id), entry);
  }
  if (targets.size === 0 && gone.length === 0) return;
  const states = await readPages(db, targets, resolved, factsAt);

  await db.runTransaction(async (tx) => {
    const [meta, ...shards] = await tx.getAll(refs.meta, ...refs.shards);
    if (!meta?.exists) return;
    const maps = readShards(shards);
    const changed = new Set<number>();
    const entryOf = (page: string) => maps[shardOf(page)]!.get(page);
    for (const page of gone) {
      const entry = entryOf(page);
      if (!entry || entry.at > at) continue;
      maps[shardOf(page)]!.delete(page);
      changed.add(shardOf(page));
    }
    for (const [page, state] of states) {
      // Taken from the entry as it stands now: the night may have counted
      // it again since, with new candidacies. One staged from later reads
      // stays.
      const entry = entryOf(page);
      if (!entry || entry.at > at) continue;
      if (state === null) {
        maps[shardOf(page)]!.delete(page);
      } else {
        const { entry: next } = stagePerson({
          candidacies: entry.candidacies,
          band: entry.band,
          page: state,
          now,
          at,
        });
        maps[shardOf(page)]!.set(page, next);
      }
      changed.add(shardOf(page));
    }
    if (changed.size === 0) return;
    const snapshot: DeclarationPeople = declarationPeopleSchema.parse(
      peopleSnapshot(
        maps.flatMap((map) => [...map]),
        now,
      ),
    );
    const data = shardData(maps.flatMap((map) => [...map]));
    for (const i of changed) tx.set(refs.shards[i]!, data[i]!);
    tx.set(refs.stats, snapshot);
  });
}

/**
 * Moves the counted people among these pages to the stage they are in now,
 * and the snapshot with them. Pages are followed through merges; one the
 * count does not hold is left alone, one that is gone or was made public some
 * other way leaves the count. Whether a page has a public post is the night's
 * to say.
 *
 * Best effort: a failure is logged and never reaches the caller, and the
 * night's count puts everything right. The writes are one transaction over
 * every shard, so two events at once both land.
 */
export async function restageDeclarationPeople(
  db: Firestore,
  pageIds: readonly string[] | undefined,
  now: Date = new Date(),
): Promise<void> {
  const ids = unique(
    (pageIds ?? []).filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    ),
  );
  if (ids.length === 0) return;
  try {
    await restage(db, ids, now);
  } catch (error) {
    console.error(
      `[declarations] re-staging ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ` and ${ids.length - 5} more` : ""} failed`,
      error,
    );
  }
}

/** Re-stages the people of these crops, and any pages besides: after an
 * admin's decision on a crop, or a reading that settled one as unreadable.
 * Best effort, like `restageDeclarationPeople`. */
export async function restageCropPeople(
  db: Firestore,
  extractIds: readonly string[],
  pages: readonly string[] = [],
  now: Date = new Date(),
): Promise<void> {
  const named = [...pages];
  const ids = unique(extractIds.filter((id) => id));
  try {
    await inParallel(
      chunksOf(ids, GET_ALL_CHUNK),
      IN_PARALLEL,
      async (chunk) => {
        const docs = await db.getAll(
          ...chunk.map((id) => db.collection(EXTRACTS).doc(id)),
          { fieldMask: ["personIds", "pageOutcomes"] },
        );
        for (const doc of docs)
          named.push(...pagesNamedBy(cropRecordOf(doc.data())));
      },
    );
  } catch (error) {
    console.error(
      `[declarations] reading the pages of ${ids.join(", ")} failed`,
      error,
    );
  }
  await restageDeclarationPeople(db, named, now);
}
