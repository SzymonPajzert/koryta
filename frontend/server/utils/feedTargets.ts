import type { Firestore } from "firebase-admin/firestore";
import { generateEntityUrl } from "~~/app/composables/slugs";
import { nodeTypes, type NodeType } from "~~/shared/model";
import type { FeedTargetType } from "~~/shared/activityFeed";

/** Where a feed line's target lives: a page, a relation, or a fact the
 * extraction pipeline proposed. */
export type FeedCollection = "nodes" | "edges" | "extractions";

/** What an event points at, before anything has been read about it. */
export type FeedTargetRef = {
  collection: FeedCollection;
  id: string;
  /** Name this page, not the one it was merged into. Only a merge's own
   * survivor wants this: following it would be right, but it is already the
   * end of the chain the merge created, and every other event wants the page
   * a reader will actually land on. */
  exact?: boolean;
  /** Both ends of a relation as the revision behind the event states them,
   * which is what the change was about even when the stored edge has since
   * moved on. */
  ends?: { source: string; target: string };
  /** What the revision behind the event calls a page, for a page that exists
   * only as a proposal and so has no node to read. */
  proposed?: { name?: string; type?: string };
};

/** A target named, typed and linked. */
export type ResolvedFeedTarget = {
  collection: FeedCollection;
  id: string;
  type: FeedTargetType;
  name: string;
  href: string | null;
  deleted?: boolean;
};

/** A target nothing read: past what its line lists, on a line whose sentence
 * counts documents rather than naming what they touched, so reading it would
 * only have paid for a number the reference already gives. Known by its
 * reference alone - a merged duplicate is not followed to its survivor - and
 * typed only when the reference says what it is. */
export type UnreadFeedTarget = {
  collection: FeedCollection;
  id: string;
  type?: FeedTargetType;
  unread: true;
};

/** `ref` as a target left unread, typed by its collection or, for a page, by
 * the revision behind the event; a vote's or a note's page stays untyped. */
export function unreadFeedTarget(ref: FeedTargetRef): UnreadFeedTarget {
  const proposed = text(ref.proposed?.type);
  const type: FeedTargetType | null =
    ref.collection === "edges"
      ? "edge"
      : ref.collection === "extractions"
        ? "fact"
        : isNodeType(proposed)
          ? proposed
          : null;
  return {
    collection: ref.collection,
    id: ref.id,
    ...(type ? { type } : {}),
    unread: true,
  };
}

/** `getAll` takes any number of refs, but one request has to fit in a call. */
const READ_CHUNK = 300;

/** How long what a document said is reused. A name changes when somebody
 * edits a page, which is rare next to how often the feed is rebuilt, and the
 * reads this saves are the bulk of a rebuild: every target of the window, each
 * time. */
const TARGET_CACHE_TTL_MS = 60 * 60_000;

/** Entries kept per collection. Far past the targets of any window the feed
 * offers, and it keeps an instance's memory bounded if a flood of votes on
 * made-up ids tries to fill it. */
const TARGET_CACHE_SIZE = 50_000;

/** The same bound `resolveMergedNode` puts on a `merged_into` chain. */
const MAX_MERGE_HOPS = 8;

/** Pages missing from `nodes` are looked up one query each, so they are capped
 * per rebuild. A page that exists only as a proposal is rare; a thousand of
 * them is somebody filing votes on ids that were never pages. */
const FALLBACK_LOOKUP_CAP = 200;
const FALLBACK_CONCURRENCY = 20;

const NODE_FIELDS = ["name", "type", "merged_into", "deleted"];
const EDGE_FIELDS = ["source", "target", "type", "deleted"];
const FACT_FIELDS = [
  "personNodeName",
  "personNodeId",
  "person",
  "organization",
  "role",
  "fact_type",
];

type NodeInfo = {
  name: string | null;
  type: string | null;
  mergedInto: string | null;
  deleted: boolean;
};
type EdgeInfo = {
  source: string | null;
  target: string | null;
  deleted: boolean;
};
type FactInfo = { name: string };
type ProposedInfo = { name: string | null; type: string | null };

/** A map whose entries age out, and whose oldest go first when it is full. */
class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; value: T }>();

  get(key: string, now: number): { value: T } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now - entry.at > TARGET_CACHE_TTL_MS) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: T, now: number): void {
    this.entries.delete(key);
    this.entries.set(key, { at: now, value });
    while (this.entries.size > TARGET_CACHE_SIZE) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

/** What each document said when it was last read, `null` for one that does
 * not exist - remembered too, so a dangling reference costs one read an hour
 * rather than one per rebuild. */
const caches = {
  nodes: new TtlCache<NodeInfo | null>(),
  edges: new TtlCache<EdgeInfo | null>(),
  extractions: new TtlCache<FactInfo | null>(),
  proposed: new TtlCache<ProposedInfo | null>(),
};

/** Forget everything read so far. Only tests need this; the entries age out on
 * their own. */
export function resetFeedTargetCache(): void {
  for (const cache of Object.values(caches)) cache.clear();
}

const utf8 = new TextEncoder();

/** Whether `id` can name a document at all.
 *
 * The ids come from votes and notes, whose rules check nothing about them, so
 * anybody can file a vote on `a/b` - and `collection().doc("a/b")` throws
 * rather than returning a missing document, which would take the whole feed
 * down with it. These are Firestore's own limits on a document id. */
export function isFeedDocId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    !id.includes("/") &&
    id !== "." &&
    id !== ".." &&
    !/^__.*__$/.test(id) &&
    utf8.encode(id).length <= 1500
  );
}

/** Names, types and links for every target, in the order given; `null` for
 * one that cannot be shown.
 *
 * A target is dropped rather than shown by its id when it cannot be named -
 * the id is whatever the voter typed, and a line that reads as a bare id is
 * worse than no line. That covers an invalid id, a document that does not
 * exist anywhere, and one whose read failed: each chunk of reads is on its own,
 * so a failure costs the events behind that chunk and not the feed.
 *
 * Pages are followed along `merged_into` to the page a reader should land on,
 * since a merged duplicate does not redirect a signed-in reader and would show
 * its stale copy. A relation is named after the two pages it joins, as the
 * revision queue names it, and links to the page at its source.
 */
export async function resolveFeedTargets(
  db: Firestore,
  refs: readonly FeedTargetRef[],
): Promise<(ResolvedFeedTarget | null)[]> {
  const read = new Reads(db, Date.now());
  const valid = refs.map((ref) => (isFeedDocId(ref.id) ? ref : null));

  const nodeIds = new Set<string>();
  const followed = new Set<string>();
  const edgeIds = new Set<string>();
  const factIds = new Set<string>();
  for (const ref of valid) {
    if (!ref) continue;
    if (ref.collection === "nodes") {
      nodeIds.add(ref.id);
      if (!ref.exact) followed.add(ref.id);
    } else if (ref.collection === "edges") {
      edgeIds.add(ref.id);
    } else {
      factIds.add(ref.id);
    }
  }

  await Promise.all([read.edgeDocs(edgeIds), read.factDocs(factIds)]);

  for (const ref of valid) {
    if (ref?.collection !== "edges") continue;
    // A failed read drops the event whatever its ends are, so they are not
    // worth reading for it.
    const edge = read.edges.get(ref.id);
    if (edge === undefined) continue;
    for (const end of endsOf(ref, edge) ?? []) {
      nodeIds.add(end);
      followed.add(end);
    }
  }

  await read.nodeChains([...nodeIds], followed);
  await read.proposals(
    [...nodeIds].filter((id) => read.nodes.get(id) === null),
    valid,
  );

  return valid.map((ref) => (ref ? read.describe(ref) : null));
}

function endsOf(
  ref: FeedTargetRef,
  edge: EdgeInfo | null | undefined,
): [string, string] | null {
  if (ref.ends && isFeedDocId(ref.ends.source) && isFeedDocId(ref.ends.target))
    return [ref.ends.source, ref.ends.target];
  if (edge && isFeedDocId(edge.source) && isFeedDocId(edge.target))
    return [edge.source, edge.target];
  return null;
}

/** Everything one call has read, cache hits included. Kept apart from the
 * module cache so that eviction halfway through a call cannot lose a document
 * the call is about to describe. */
class Reads {
  readonly nodes = new Map<string, NodeInfo | null>();
  readonly edges = new Map<string, EdgeInfo | null>();
  readonly extractions = new Map<string, FactInfo | null>();
  readonly proposed = new Map<string, ProposedInfo | null>();
  /** Ids already asked for in this call, so a failed chunk is not retried on
   * every hop of a merge chain. */
  private readonly attempted = new Set<string>();

  constructor(
    private readonly db: Firestore,
    private readonly now: number,
  ) {}

  edgeDocs(ids: Iterable<string>): Promise<void> {
    return this.chunked(
      "edges",
      this.edges,
      caches.edges,
      EDGE_FIELDS,
      edgeInfo,
      ids,
    );
  }

  factDocs(ids: Iterable<string>): Promise<void> {
    return this.chunked(
      "extractions",
      this.extractions,
      caches.extractions,
      FACT_FIELDS,
      factInfo,
      ids,
    );
  }

  private nodeDocs(ids: Iterable<string>): Promise<void> {
    return this.chunked(
      "nodes",
      this.nodes,
      caches.nodes,
      NODE_FIELDS,
      nodeInfo,
      ids,
    );
  }

  private async chunked<T>(
    collection: FeedCollection,
    found: Map<string, T | null>,
    cache: TtlCache<T | null>,
    fieldMask: string[],
    parse: (data: Record<string, unknown>) => T,
    ids: Iterable<string>,
  ): Promise<void> {
    const wanted: string[] = [];
    for (const id of new Set(ids)) {
      const key = `${collection}/${id}`;
      if (found.has(id) || this.attempted.has(key)) continue;
      this.attempted.add(key);
      const hit = cache.get(id, this.now);
      if (hit) found.set(id, hit.value);
      else wanted.push(id);
    }

    const chunks: string[][] = [];
    for (let i = 0; i < wanted.length; i += READ_CHUNK) {
      chunks.push(wanted.slice(i, i + READ_CHUNK));
    }
    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const refs = chunk.map((id) =>
            this.db.collection(collection).doc(id),
          );
          const snapshots = await this.db.getAll(...refs, { fieldMask });
          for (const snapshot of snapshots) {
            const value = snapshot.exists ? parse(snapshot.data() ?? {}) : null;
            found.set(snapshot.id, value);
            cache.set(snapshot.id, value, this.now);
          }
        } catch (error) {
          console.warn(
            `activityFeed: could not read ${chunk.length} ${collection}, their events are left out`,
            error,
          );
        }
      }),
    );
  }

  /** Reads every page, then the pages each followed one was merged into, until
   * no chain has an unread link left. */
  async nodeChains(ids: string[], followed: Set<string>): Promise<void> {
    await this.nodeDocs(ids);
    for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
      const unread = new Set<string>();
      for (const id of followed) {
        const next = this.walk(id).unread;
        if (next) unread.add(next);
      }
      if (unread.size === 0) return;
      await this.nodeDocs(unread);
    }
  }

  /** The end of `id`'s `merged_into` chain as far as it has been read, and the
   * next link when that has not been read yet. A link to a page that does not
   * exist, or back into the chain, stops at the last real page: it is a better
   * answer than none. */
  private walk(id: string): { id: string; unread?: string } {
    let current = id;
    const seen = new Set([id]);
    for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
      const next = this.nodes.get(current)?.mergedInto;
      if (!next || seen.has(next) || !isFeedDocId(next)) break;
      if (!this.nodes.has(next)) {
        return this.attempted.has(`nodes/${next}`)
          ? { id: current }
          : { id: current, unread: next };
      }
      if (this.nodes.get(next) === null) break;
      seen.add(next);
      current = next;
    }
    return { id: current };
  }

  /** Pages that exist only as a proposal: named after the revision the event
   * came with, or else after the newest revision of that page - the fallback
   * `resolveNodes` in notes.ts uses, for the same kind of note. */
  async proposals(
    ids: string[],
    refs: readonly (FeedTargetRef | null)[],
  ): Promise<void> {
    const wanted = new Set(ids);
    for (const ref of refs) {
      if (ref?.collection !== "nodes" || !wanted.has(ref.id)) continue;
      const type = text(ref.proposed?.type);
      if (!isNodeType(type)) continue;
      this.proposed.set(ref.id, { name: text(ref.proposed?.name), type });
    }

    const lookups: string[] = [];
    for (const id of wanted) {
      if (this.proposed.has(id)) continue;
      const hit = caches.proposed.get(id, this.now);
      if (hit) this.proposed.set(id, hit.value);
      else lookups.push(id);
    }
    if (lookups.length > FALLBACK_LOOKUP_CAP) {
      console.warn(
        `activityFeed: ${lookups.length} targets are neither pages nor proposals, looking up ${FALLBACK_LOOKUP_CAP}`,
      );
    }

    const capped = lookups.slice(0, FALLBACK_LOOKUP_CAP);
    for (let i = 0; i < capped.length; i += FALLBACK_CONCURRENCY) {
      await Promise.all(
        capped.slice(i, i + FALLBACK_CONCURRENCY).map(async (id) => {
          try {
            const snapshot = await this.db
              .collection("revisions")
              .where("node_id", "==", id)
              .orderBy("update_time", "desc")
              .select("data.name", "data.type")
              .limit(1)
              .get();
            const newest = snapshot.docs[0];
            const value: ProposedInfo | null = newest
              ? {
                  name: text(newest.get("data.name")),
                  type: text(newest.get("data.type")),
                }
              : null;
            this.proposed.set(id, value);
            caches.proposed.set(id, value, this.now);
          } catch (error) {
            console.warn(
              `activityFeed: could not look up proposal ${id}`,
              error,
            );
          }
        }),
      );
    }
  }

  describe(ref: FeedTargetRef): ResolvedFeedTarget | null {
    if (ref.collection === "nodes") return this.page(ref.id, !ref.exact);
    if (ref.collection === "extractions") {
      const fact = this.extractions.get(ref.id);
      if (!fact) return null;
      return {
        collection: "extractions",
        id: ref.id,
        type: "fact",
        name: fact.name,
        href: `/ekstrakcje/kategoryzacja?fact=${encodeURIComponent(ref.id)}`,
      };
    }

    // `undefined` is a read that failed; `null` an edge that is gone, which a
    // revision naming both of its ends can still describe.
    const edge = this.edges.get(ref.id);
    if (edge === undefined) return null;
    const ends = endsOf(ref, edge);
    if (!ends) return null;
    const source = this.page(ends[0], true);
    const target = this.page(ends[1], true);
    if (!source || !target) return null;
    const deleted = edge?.deleted === true;
    return {
      collection: "edges",
      id: ref.id,
      type: "edge",
      name: `${source.name} → ${target.name}`,
      href: deleted ? null : source.href,
      ...(deleted ? { deleted } : {}),
    };
  }

  private page(id: string, follow: boolean): ResolvedFeedTarget | null {
    const final = follow ? this.walk(id).id : id;
    const node = this.nodes.get(final);
    if (node === undefined) return null;
    const info = node ?? this.proposed.get(final);
    if (!info) return null;

    const type = info.type;
    if (!isNodeType(type)) return null;
    // A page with no name still has a type and a link; its id is never shown
    // in its place.
    const name = info.name ?? "bez nazwy";
    const deleted = node?.deleted === true;
    return {
      collection: "nodes",
      id: final,
      type,
      name,
      href: deleted
        ? null
        : generateEntityUrl(type, final, info.name ?? undefined),
      ...(deleted ? { deleted } : {}),
    };
  }
}

function nodeInfo(data: Record<string, unknown>): NodeInfo {
  return {
    name: text(data.name),
    type: text(data.type),
    mergedInto: text(data.merged_into),
    deleted: data.deleted === true,
  };
}

function edgeInfo(data: Record<string, unknown>): EdgeInfo {
  return {
    source: text(data.source),
    target: text(data.target),
    deleted: data.deleted === true,
  };
}

/** A fact is named after the person it is about, the way the article or the
 * graph spells them, and the organisation when there is one - "Jan Kowalski ·
 * PKP SA" says which of a person's facts it is. */
function factInfo(data: Record<string, unknown>): FactInfo {
  const who = text(data.personNodeName) ?? text(data.person) ?? "fakt";
  const where = text(data.organization);
  return { name: where ? `${who} · ${where}` : who };
}

function isNodeType(type: string | null): type is NodeType {
  return type !== null && (nodeTypes as readonly string[]).includes(type);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
