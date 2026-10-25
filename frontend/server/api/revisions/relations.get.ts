import { z } from "zod";
import {
  getFirestore,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { requireAdmin } from "~~/server/utils/auth";
import { fetchEdgesForNode } from "~~/server/utils/edgePublication";
import {
  describeRevisions,
  nodeTypeOf,
  targetIdOf,
} from "~~/server/utils/revisionQueue";
import { generateEntityUrl } from "~~/shared/slugs";
import {
  approvedRevisionId,
  pageIsPublic,
  type NodeType,
} from "~~/shared/model";
import type { Proposal } from "~~/shared/proposals";

const queryValidator = z.object({ nodeId: z.string().min(1) });

/** How many relations one answer describes. A person has at most 72 and a
 * company 191 (2026-10-17 export), so both come back whole; a region or an
 * article can hold well over a thousand, and nobody reviews Warszawa's 1,502
 * candidacies here. Past the cap the ones that wait for somebody come first,
 * and `total` says how many there are. */
export const MAX_RELATIONS = 300;

/** Firestore's ceiling for an `in` filter. */
const IN_CHUNK = 30;

/** `getAll` reads at most this many documents per call in practice. */
const GET_ALL_CHUNK = 100;

/** The page at the far end of a relation. */
export type RelationEnd = {
  id: string;
  name: string | null;
  type: NodeType | null;
  /** Where to read it, or null when it no longer exists. */
  path: string | null;
  published: boolean;
};

/** Where a relation stands, worst first, which is also the order the list
 * goes in:
 * - `proposals`: live, with a change somebody filed still waiting;
 * - `draft`: not on the site;
 * - `settled`: live, nothing waiting;
 * - `removed`: taken off by an admin and kept for the record. */
export type RelationState = "proposals" | "draft" | "settled" | "removed";

export type RelationHistory = {
  /** The edge's id. */
  id: string;
  type: string;
  /** A job title, or „kandydatura”. */
  name: string | null;
  /** Whether this page is the edge's source. */
  direction: "outgoing" | "incoming";
  other: RelationEnd;
  startDate: string | null;
  endDate: string | null;
  /** A candidacy's office. */
  position: string | null;
  committee: string | null;
  elected: boolean;
  published: boolean;
  deleted: boolean;
  state: RelationState;
  /** Whether both ends are live, which a relation needs before it can go on
   * the site. */
  publishable: boolean;
  approvedRevisionId: string | null;
  /** Revisions stored as `pending`. Stricter than a resolved `Oczekuje`, on
   * purpose: a revision written before review existed carries no status and
   * reads as pending wherever nothing points at it, but nobody is waiting on
   * one (see `hasPendingRevision`). */
  waiting: number;
  /** Newest first. */
  revisions: Proposal[];
};

export type NodeRelationHistory = {
  /** At most `MAX_RELATIONS`, in `RelationState` order. */
  relations: RelationHistory[];
  /** Every relation of the page, past the cap included. */
  total: number;
  /** Relations not on the site, removed ones aside. */
  drafts: number;
  /** Live relations with a change still waiting, and how many changes. */
  withProposals: number;
  proposals: number;
  /** Whether the page itself is live. Until it is, none of its relations can
   * be published on their own. */
  nodePublished: boolean;
};

/** What waits on an entry's relations, for the signal at the top of its page. */
export type RelationSummary = Pick<
  NodeRelationHistory,
  "total" | "drafts" | "withProposals" | "proposals"
>;

/**
 * Every relation of one entry, each with the history of its revisions.
 *
 * An entry's own history (`/api/revisions/node`) is the page's text. What the
 * nights change most is around it: a candidacy's office, a committee, a seat
 * the register closed, written to the relation and not the page. Those
 * revisions carry the edge's id in `node_id`, so nothing that reads an entry's
 * revisions ever found them, and a page could have a draft candidacy and two
 * proposals waiting while its own history read „nic nie czeka”. Hubert Papaj's
 * did, on 2026-10-17.
 *
 * The revisions are described the way the queue describes them
 * (`describeRevisions`): the author resolved, the status reconciled with what
 * the relation points at, and each change measured against the relation's
 * approved version. A revision therefore reads the same here, in the queue and
 * in the „Zmiany powiązań” list.
 *
 * Admin-only, as `/api/edges/byNode` is: which pages are still drafts is not
 * for anybody else to enumerate, and the authors' names come back with it.
 */
export default defineEventHandler(
  async (event): Promise<NodeRelationHistory> => {
    await requireAdmin(event);
    const { nodeId } = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );
    setResponseHeader(event, "Cache-Control", "private, no-store");

    const db = getFirestore("koryta-pl");
    const [edges, node] = await Promise.all([
      fetchEdgesForNode(db, nodeId),
      db.collection("nodes").doc(nodeId).get(),
    ]);
    const nodePublished = node.exists && pageIsPublic(node.data() ?? {});

    // The cap is applied before anything is read per relation, so it has to
    // order by what the edges themselves say: the drafts first, then the
    // newest. Whether a live relation has a proposal waiting only shows in its
    // revisions, which is the read the cap is there to bound.
    const capped = [...edges]
      .sort(
        (a, b) =>
          Number(pageIsPublic(a) || a.deleted === true) -
            Number(pageIsPublic(b) || b.deleted === true) ||
          (b.start_date ?? "").localeCompare(a.start_date ?? ""),
      )
      .slice(0, MAX_RELATIONS);

    const otherIds = capped.map((edge) =>
      edge.source === nodeId ? edge.target : edge.source,
    );
    const [ends, revisionDocs] = await Promise.all([
      readEnds(db, otherIds),
      readRevisions(
        db,
        capped.map((edge) => edge.id),
      ),
    ]);

    const described = await describeRevisions(db, revisionDocs, {
      withAuthors: true,
      allChanges: true,
    });
    const byEdge = new Map<string, Proposal[]>();
    const waitingByEdge = new Map<string, number>();
    revisionDocs.forEach((doc, index) => {
      const edgeId = targetIdOf(doc);
      if (!edgeId) return;
      byEdge.set(edgeId, [...(byEdge.get(edgeId) ?? []), described[index]!]);
      if (doc.get("status") === "pending") {
        waitingByEdge.set(edgeId, (waitingByEdge.get(edgeId) ?? 0) + 1);
      }
    });

    const relations = capped.map((edge): RelationHistory => {
      const outgoing = edge.source === nodeId;
      const otherId = outgoing ? edge.target : edge.source;
      const other = ends.get(otherId) ?? {
        id: otherId,
        name: null,
        type: null,
        path: null,
        published: false,
      };
      const published = pageIsPublic(edge);
      const deleted = edge.deleted === true;
      const waiting = waitingByEdge.get(edge.id) ?? 0;
      return {
        id: edge.id,
        type: edge.type,
        name: text(edge.name),
        direction: outgoing ? "outgoing" : "incoming",
        other,
        startDate: text(edge.start_date),
        endDate: text(edge.end_date),
        position: text(edge.position),
        committee: text(edge.committee),
        elected: edge.elected === true,
        published,
        deleted,
        state: deleted
          ? "removed"
          : !published
            ? "draft"
            : waiting > 0
              ? "proposals"
              : "settled",
        // A self-edge has no far end to wait for.
        publishable:
          nodePublished && (otherId === nodeId ? true : other.published),
        approvedRevisionId: approvedRevisionId(edge.revision_id) ?? null,
        waiting,
        revisions: (byEdge.get(edge.id) ?? []).sort(
          (a, b) => timeOf(b.updateTime) - timeOf(a.updateTime),
        ),
      };
    });

    relations.sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        latestWaiting(b) - latestWaiting(a) ||
        typeRank(a.type) - typeRank(b.type) ||
        (b.startDate ?? "").localeCompare(a.startDate ?? "") ||
        (a.other.name ?? a.other.id).localeCompare(
          b.other.name ?? b.other.id,
          "pl",
        ),
    );

    const live = edges.filter((edge) => edge.deleted !== true);
    const withProposals = relations.filter(
      (relation) => relation.state === "proposals",
    );
    return {
      relations,
      total: edges.length,
      drafts: live.filter((edge) => !pageIsPublic(edge)).length,
      withProposals: withProposals.length,
      proposals: withProposals.reduce(
        (sum, relation) => sum + relation.waiting,
        0,
      ),
      nodePublished,
    };
  },
);

const STATE_ORDER: Record<RelationState, number> = {
  proposals: 0,
  draft: 1,
  settled: 2,
  removed: 3,
};

/** Candidacies, then jobs, then the rest: the order a person's page lists
 * them in. */
function typeRank(type: string): number {
  const order = ["election", "employed", "owns", "seat"];
  const index = order.indexOf(type);
  return index === -1 ? order.length : index;
}

/** When the newest change still waiting on a relation was filed, so the
 * relation somebody touched last comes first among those waiting. */
function latestWaiting(relation: RelationHistory): number {
  const times = relation.revisions
    .filter(
      (revision) => revision.status === "pending" && !revision.statusDerived,
    )
    .map((revision) => timeOf(revision.updateTime));
  return times.length > 0 ? Math.max(...times) : -Infinity;
}

/** The far end of each relation: what it is called, what kind of page it is
 * and whether it is live. Masked to those fields, a hundred at a time. */
async function readEnds(
  db: Firestore,
  ids: string[],
): Promise<Map<string, RelationEnd>> {
  const wanted = [...new Set(ids)];
  const ends = new Map<string, RelationEnd>();
  for (let i = 0; i < wanted.length; i += GET_ALL_CHUNK) {
    const chunk = wanted.slice(i, i + GET_ALL_CHUNK);
    const snapshots = await db.getAll(
      ...chunk.map((id) => db.collection("nodes").doc(id)),
      { fieldMask: ["name", "type", "published", "deleted"] },
    );
    snapshots.forEach((snapshot, index) => {
      const id = chunk[index]!;
      if (!snapshot.exists) return;
      const data = snapshot.data() ?? {};
      const name = text(data.name);
      const type = nodeTypeOf(data);
      ends.set(id, {
        id,
        name,
        type,
        path: type ? generateEntityUrl(type, id, name ?? undefined) : null,
        published: pageIsPublic(data),
      });
    });
  }
  return ends;
}

/** Every revision written against these edges, thirty edges a query. Edge
 * revisions name their edge in `node_id`; the camel-cased `nodeId` only ever
 * appears on old node revisions, which is why `edgeRevisionsForMany` asks for
 * the one spelling too. */
async function readRevisions(
  db: Firestore,
  edgeIds: string[],
): Promise<QueryDocumentSnapshot[]> {
  const docs: QueryDocumentSnapshot[] = [];
  for (let i = 0; i < edgeIds.length; i += IN_CHUNK) {
    const chunk = edgeIds.slice(i, i + IN_CHUNK);
    const snapshot = await db
      .collection("revisions")
      .where("node_id", "in", chunk)
      .get();
    docs.push(...snapshot.docs);
  }
  return docs;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** A revision with no time sorts last: it is the oldest thing there is. */
function timeOf(iso: string | null): number {
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(time) ? -Infinity : time;
}
