import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/logger";
import { warsawDate, warsawHour } from "~~/shared/dates";

/**
 * An aggregate over whole collections, computed once per backend and period
 * and kept in `stats` for every instance to read.
 *
 * Nitro's cache lives in one instance's memory, and Cloud Run starts fresh
 * instances as traffic grows, each of which scanned the collections again: on
 * 2026-11-23 /api/stats/database alone read 1.43M documents between 07:00 and
 * 11:15 UTC. The Nitro cache stays in front of this, so an instance reads the
 * stored copy at most once per its maxAge.
 *
 * One document per backend, overwritten in place, in `stats` rather than a
 * collection of its own (decision on 2026-11-20). The build is in the key, as
 * in `storedMilestones.ts`: a rollout computes again rather than serving what
 * an older build computed.
 *
 * The value is stored as JSON text. Firestore refuses undefined and nested
 * arrays, and indexes one text field once where a list of rows would be
 * indexed row by row. A value over `PART_BYTES` continues in documents named
 * `<docId>_part<n>`, all written in one batch.
 */
export const STORED_AGGREGATE_TYPE = "storedAggregate";

/** The most of the JSON one document holds. A document is at most 1 MiB, and
 * this leaves room for the fields beside it. */
export const PART_BYTES = 900_000;

interface StoredAggregateDoc {
  type: typeof STORED_AGGREGATE_TYPE;
  name: string;
  /** `<build>|<period>`. */
  key: string;
  computedAt: string;
  /** How many documents hold the value. */
  parts: number;
  /** Which of them this is, from 0. */
  part: number;
  /** This document's piece of the JSON. */
  json: string;
}

/** Which document this process keeps an aggregate in, and what it must say. */
export interface StoredAggregateKey {
  /** The first document in `stats`. */
  docId: string;
  /** `<build>|<period>`. */
  key: string;
}

export interface StoredAggregateOptions<T> {
  /** Names the document: `stats/<name>_<backend>`. */
  name: string;
  /** What the value stands for, such as `warsawSixHourWindow()`. A new period
   * computes again. */
  period: string;
  compute: () => Promise<T>;
  /** The site's database unless given. */
  db?: Firestore;
}

/** The six-hour window of a Warsaw clock that `now` falls in, as
 * `2026-11-23T12`. Windows open at 00, 06, 12 and 18. */
export function warsawSixHourWindow(now: Date = new Date()): string {
  const hour = Math.floor(warsawHour(now) / 6) * 6;
  return `${warsawDate(now)}T${String(hour).padStart(2, "0")}`;
}

/** Where this process keeps `name` for `period`, or null off Cloud Run: nuxt
 * dev, the emulators and the tests compute on every call, so a local change
 * never hides behind a stored result. */
export function storedAggregateKey(
  name: string,
  period: string,
): StoredAggregateKey | null {
  const backend = process.env.K_SERVICE;
  const build = process.env.K_REVISION;
  if (!backend || !build) return null;
  return { docId: `${name}_${backend}`, key: `${build}|${period}` };
}

function partId(docId: string, part: number): string {
  return part === 0 ? docId : `${docId}_part${part}`;
}

/** `text` in pieces of at most `maxBytes` of UTF-8, none cut inside a
 * character. */
export function splitUtf8(text: string, maxBytes: number): string[] {
  // A character takes up to four bytes, so a piece always holds one.
  if (maxBytes < 4) throw new RangeError("maxBytes must be at least 4");
  const bytes = Buffer.from(text, "utf8");
  const pieces: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + maxBytes, bytes.length);
    // 10xxxxxx continues the character before it.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    pieces.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return pieces;
}

/** The stored value, or undefined when there is none under this key. */
export async function readStoredAggregate<T>(
  db: Firestore,
  where: StoredAggregateKey,
): Promise<T | undefined> {
  const stats = db.collection("stats");
  const head = await stats.doc(where.docId).get();
  if (!head.exists) return undefined;
  const first = head.data() as Partial<StoredAggregateDoc> | undefined;
  if (
    first?.key !== where.key ||
    typeof first.json !== "string" ||
    !Number.isInteger(first.parts) ||
    first.parts! < 1
  ) {
    return undefined;
  }

  const pieces = [first.json];
  if (first.parts! > 1) {
    const refs = [];
    for (let part = 1; part < first.parts!; part++) {
      refs.push(stats.doc(partId(where.docId, part)));
    }
    const snaps = await db.getAll(...refs);
    for (const [index, snap] of snaps.entries()) {
      const data = snap.data() as Partial<StoredAggregateDoc> | undefined;
      // Another write landed between the reads: treated as nothing stored.
      if (
        data?.key !== first.key ||
        data.computedAt !== first.computedAt ||
        data.part !== index + 1 ||
        typeof data.json !== "string"
      ) {
        return undefined;
      }
      pieces.push(data.json);
    }
  }
  return JSON.parse(pieces.join("")) as T;
}

/** Stores `value` under `where`, returning how many documents it took. */
export async function writeStoredAggregate(
  db: Firestore,
  where: StoredAggregateKey,
  name: string,
  value: unknown,
  now: Date,
): Promise<number> {
  // Undefined for an undefined value, whatever the declared type says.
  const json = JSON.stringify(value) as string | undefined;
  if (json === undefined) return 0;
  const pieces = splitUtf8(json, PART_BYTES);
  const stats = db.collection("stats");
  const batch = db.batch();
  pieces.forEach((piece, part) => {
    const doc: StoredAggregateDoc = {
      type: STORED_AGGREGATE_TYPE,
      name,
      key: where.key,
      computedAt: now.toISOString(),
      parts: pieces.length,
      part,
      json: piece,
    };
    batch.set(stats.doc(partId(where.docId, part)), doc);
  });
  await batch.commit();
  return pieces.length;
}

/** What `compute` returns, as this backend stored it for `period`; computed
 * and stored when nothing is stored for this build and period. */
export async function storedAggregate<T>(
  options: StoredAggregateOptions<T>,
): Promise<T> {
  const { name, period, compute } = options;
  const where = storedAggregateKey(name, period);
  if (!where) return compute();
  const db = options.db ?? getFirestore("koryta-pl");

  try {
    const stored = await readStoredAggregate<T>(db, where);
    if (stored !== undefined) return stored;
  } catch (error) {
    logger.error(`[storedAggregate] ${name} could not be read`, {
      key: where.key,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const value = await compute();
  // A failed write costs the next instance a compute, not this reader an answer.
  try {
    const parts = await writeStoredAggregate(
      db,
      where,
      name,
      value,
      new Date(),
    );
    logger.info(`[storedAggregate] computed and stored ${name}`, {
      key: where.key,
      parts,
    });
  } catch (error) {
    logger.error(`[storedAggregate] ${name} could not be stored`, {
      key: where.key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return value;
}
