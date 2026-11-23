import { logger } from "firebase-functions/logger";
import type { NodeFilterOp } from "~~/server/utils/nodeFilters";

/** Values Firestore takes in one array-contains-any. */
export const ARRAY_ANY_LIMIT = 30;

/** Chunked queries above which one read of the base set costs less. A sector
 * has at most 1,254 companies (szpitale, 42 chunks, on the 2026-11-23 export). */
const MAX_CHUNKS = 60;
/** Chunked queries in flight at once. */
const CHUNK_CONCURRENCY = 8;
/** A read at least this big is logged, with what put it in memory. */
const LARGE_READ = 5000;

type Doc = FirebaseFirestore.QueryDocumentSnapshot;
type WideOp = NodeFilterOp & { wide: { field: string; values: string[] } };

export type MatchingRead = {
  docs: Doc[];
  /** `chunks`: the wide op asked in pieces; `query`: one query. */
  how: "chunks" | "query";
  /** The ops Firestore applied. The caller applies every op in memory anyway,
   * so this is for the logs and the tests. */
  inFirestore: string[];
};

/** A missing composite index, or an op that only runs in memory (its
 * `applyFs` throws a message with "index" in it on purpose). */
export function isIndexError(error: unknown): boolean {
  const e = error as { code?: number; message?: unknown } | null;
  return (
    e?.code === 9 ||
    (typeof e?.message === "string" &&
      e.message.toLowerCase().includes("index"))
  );
}

const opName = (op: NodeFilterOp) => op.name ?? "unnamed";
const names = (ops: NodeFilterOp[]) => ops.map(opName);

const warned = new Set<string>();
/** Once per instance for each shape, so a busy hour does not repeat it. */
function warnOnce(
  label: string,
  shape: string,
  message: string,
  error: unknown,
) {
  if (warned.has(`${label}|${shape}`)) return;
  warned.add(`${label}|${shape}`);
  logger.warn(`[${label}] ${message}`, {
    shape,
    // Firestore's own message names the index and links to creating it.
    error: error instanceof Error ? error.message : String(error),
  });
}

/** Reports a missing index for a query the caller built itself, the same way
 * `readMatching` reports its own. */
export function warnMissingIndex(
  label: string,
  ops: NodeFilterOp[],
  error: unknown,
) {
  warnOnce(
    label,
    names(ops).join(","),
    "missing index, read in memory instead",
    error,
  );
}

/** The documents `ops` could match, read with as few documents as Firestore
 * allows. The caller still applies every op in memory: Firestore applies only
 * some of them, and which ones depends on the indexes.
 *
 * A wide op (a województwo, a sector) is asked as chunked array-contains-any
 * queries together with the base ops, which reads the people tied to those
 * places rather than every person: 166 instead of 26,783 for opolskie on
 * 2026-11-23. Otherwise one query with as many ops as Firestore takes, those
 * that only run in memory last, so that what can narrow the read stays in it.
 * It never goes below the first op (the type, or the id), so it never reads
 * the whole collection.
 */
export async function readMatching(
  db: FirebaseFirestore.Firestore,
  ops: NodeFilterOp[],
  options: { label: string; select?: string[] },
): Promise<MatchingRead> {
  if (ops.length === 0) {
    throw new Error("readMatching needs at least one op");
  }
  const { label, select } = options;

  // One page by id is one read whatever else is asked.
  const wide = ops.some((op) => op.name === "id")
    ? undefined
    : narrowestWide(ops);
  if (
    wide &&
    Math.ceil(wide.wide.values.length / ARRAY_ANY_LIMIT) <= MAX_CHUNKS
  ) {
    const base = ops.filter((op) => op.base);
    const typeOnly = base.filter((op) => op.name === "type");
    const attempts = typeOnly.length < base.length ? [base, typeOnly] : [base];
    for (const attempt of attempts) {
      try {
        const docs = await readChunks(db, attempt, wide, select);
        const read: MatchingRead = {
          docs,
          how: "chunks",
          inFirestore: [...names(attempt), opName(wide)],
        };
        logLarge(label, read, ops);
        return read;
      } catch (error) {
        if (!isIndexError(error)) throw error;
        warnOnce(
          label,
          `chunks:${[...names(attempt), wide.wide.field].join(",")}`,
          "missing index for the chunked query",
          error,
        );
      }
    }
  }

  let fsOps = [
    ...ops.filter((op) => !op.memoryOnly),
    ...ops.filter((op) => op.memoryOnly),
  ];
  for (;;) {
    try {
      let query: FirebaseFirestore.Query = db.collection("nodes");
      for (const op of fsOps) query = op.applyFs(query);
      if (select) query = query.select(...select);
      const snapshot = await query.get();
      const read: MatchingRead = {
        docs: snapshot.docs,
        how: "query",
        inFirestore: names(fsOps),
      };
      logLarge(label, read, ops);
      return read;
    } catch (error) {
      if (!isIndexError(error) || fsOps.length === 1) throw error;
      const dropped = fsOps[fsOps.length - 1]!;
      if (!dropped.memoryOnly) {
        warnOnce(
          label,
          names(fsOps).join(","),
          `missing index, ${opName(dropped)} filtered in memory`,
          error,
        );
      }
      fsOps = fsOps.slice(0, -1);
    }
  }
}

/** The wide op with the fewest values, when there are two (a sector and a
 * województwo): it makes the fewest queries. */
function narrowestWide(ops: NodeFilterOp[]): WideOp | undefined {
  const wide = ops.filter((op): op is WideOp => op.wide !== undefined);
  return wide.sort((a, b) => a.wide.values.length - b.wide.values.length)[0];
}

async function readChunks(
  db: FirebaseFirestore.Firestore,
  base: NodeFilterOp[],
  wide: WideOp,
  select: string[] | undefined,
): Promise<Doc[]> {
  const { field, values } = wide.wide;
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += ARRAY_ANY_LIMIT) {
    chunks.push(values.slice(i, i + ARRAY_ANY_LIMIT));
  }

  const byId = new Map<string, Doc>();
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < chunks.length) {
      const chunk = chunks[next++]!;
      let query: FirebaseFirestore.Query = db.collection("nodes");
      for (const op of base) query = op.applyFs(query);
      query = query.where(field, "array-contains-any", chunk);
      if (select) query = query.select(...select);
      try {
        const snapshot = await query.get();
        // A person tied to places in two chunks comes back from both.
        for (const doc of snapshot.docs) byId.set(doc.id, doc);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker),
  );
  // In id order, as one query returns them, whatever order the chunks came in.
  return [...byId.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

function logLarge(label: string, read: MatchingRead, ops: NodeFilterOp[]) {
  if (read.docs.length < LARGE_READ) return;
  logger.warn(`[${label}] read ${read.docs.length} documents`, {
    how: read.how,
    inFirestore: read.inFirestore,
    ops: names(ops),
  });
}

/** Lists kept for a few minutes in this instance's memory, so the next page of
 * the same list costs no reads. Bounded by the rows it holds in all, oldest
 * dropped first; a list over the bound is not kept at all. */
export class ListMemo<T> {
  private entries = new Map<string, { at: number; rows: T[] }>();
  private held = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxRows: number,
  ) {}

  get(key: string, now = Date.now()): T[] | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now - entry.at > this.ttlMs) {
      this.drop(key);
      return undefined;
    }
    return entry.rows;
  }

  set(key: string, rows: T[], now = Date.now()): void {
    this.drop(key);
    if (rows.length > this.maxRows) return;
    this.entries.set(key, { at: now, rows });
    this.held += rows.length;
    for (const oldest of this.entries.keys()) {
      if (this.held <= this.maxRows) break;
      this.drop(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
    this.held = 0;
  }

  private drop(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.held -= entry.rows.length;
    this.entries.delete(key);
  }
}
