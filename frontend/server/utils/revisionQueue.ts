import type {
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { generateEntityUrl } from "~~/app/composables/slugs";
import {
  approvedRevisionId,
  nodeTypes,
  pageIsPublic,
  revisionCollection,
  type NodeType,
} from "~~/shared/model";
import { normalizeUpdateTime } from "~~/shared/revisions";
import { revisionChanges } from "~~/shared/revisionChanges";
import {
  MAX_INLINE_CHANGES,
  resolveProposalStatus,
  type Proposal,
  type ProposalKind,
} from "~~/shared/proposals";
import { withoutInternalFields } from "~~/server/utils/revisions";

/** `getUsers` takes at most 100 identifiers per call. */
const AUTH_LOOKUP_CHUNK = 100;

export interface DescribeOptions {
  /** Resolve the author's name, email and avatar.
   *
   * Off for `/api/revisions/mine`: the caller is the author, so it would tell
   * them their own name, and leaving it off keeps the endpoint from being one
   * `getAuth().getUser` away from the admin-only `/api/users/lookup`.
   */
  withAuthors: boolean;
  /** Every changed field, rather than the first `MAX_INLINE_CHANGES`.
   *
   * The cap is for a queue row, which has one table cell to say what a
   * proposal does. An entry's own history opens one revision at a time, and a
   * reviewer who opened it to read the change wants all of it - "…i jeszcze 3
   * pola" is a link to somewhere else there, not a summary.
   */
  allChanges?: boolean;
}

/**
 * Turns raw revision documents into rows a reviewer or an author can read.
 *
 * The expensive part is the join, and it is done in batches over the *page
 * slice* rather than per row: the distinct targets in one `getAll`, then the
 * revisions those targets point at, then - for edge revisions only - the nodes
 * at their ends, masked to a name and a type. A page of 25 therefore costs a
 * fixed handful of batched reads however many revisions were scanned to find
 * it.
 *
 * Identities come from Firebase Auth, which is not billed as Firestore reads. A
 * uid that no longer resolves keeps its row with null fields - the proposal was
 * still made, and dropping it would quietly shrink a queue.
 */
export async function describeRevisions(
  db: Firestore,
  docs: (QueryDocumentSnapshot | DocumentSnapshot)[],
  options: DescribeOptions,
): Promise<Proposal[]> {
  if (docs.length === 0) return [];

  const targets = await readTargets(db, docs);
  const [approved, endpoints, authors] = await Promise.all([
    readApprovedRevisions(db, targets),
    readEdgeEndpoints(db, docs, targets),
    options.withAuthors
      ? readAuthors(docs.map((doc) => doc.get("update_user")))
      : Promise.resolve(new Map<string, AuthorInfo>()),
  ]);

  return docs.map((doc) =>
    describeOne(doc, {
      targets,
      approved,
      endpoints,
      authors: options.withAuthors ? authors : null,
      allChanges: options.allChanges === true,
    }),
  );
}

type TargetInfo = {
  exists: boolean;
  data: Record<string, unknown>;
  approvedId: string | undefined;
};

type AuthorInfo = {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

type ApprovedRevision = {
  /** The snapshot the target is actually serving, which is what a proposal is
   * a change *to*. */
  data: Record<string, unknown>;
  /** When it landed on the target. */
  changedAt: string | null;
};

type EndpointInfo = {
  id: string;
  name: string | null;
  type: NodeType | null;
  path: string | null;
};

type Context = {
  targets: Map<string, TargetInfo>;
  approved: Map<string, ApprovedRevision>;
  endpoints: Map<string, EndpointInfo>;
  authors: Map<string, AuthorInfo> | null;
  allChanges: boolean;
};

/** The key a revision's target is cached under. `node_id` is the target's id
 * whatever the target is, so the collection has to be part of the key or a node
 * and an edge that happen to share an id would collide. */
function targetKey(collection: string, id: string): string {
  return `${collection}/${id}`;
}

async function readTargets(
  db: Firestore,
  docs: (QueryDocumentSnapshot | DocumentSnapshot)[],
): Promise<Map<string, TargetInfo>> {
  const wanted = new Map<string, { collection: string; id: string }>();
  for (const doc of docs) {
    const collection = revisionCollection(doc.data() ?? {});
    const id = targetIdOf(doc);
    if (!id) continue;
    wanted.set(targetKey(collection, id), { collection, id });
  }

  const entries = [...wanted.entries()];
  if (entries.length === 0) return new Map();

  const snapshots = await db.getAll(
    ...entries.map(([, { collection, id }]) =>
      db.collection(collection).doc(id),
    ),
  );

  const targets = new Map<string, TargetInfo>();
  entries.forEach(([key], index) => {
    const snapshot = snapshots[index];
    const data = snapshot?.data() ?? {};
    targets.set(key, {
      exists: snapshot?.exists ?? false,
      data,
      approvedId: approvedRevisionId(data.revision_id),
    });
  });
  return targets;
}

/** What each target's approved revision says, and when it landed.
 *
 * Two things depend on it. The snapshot is the baseline a proposal is diffed
 * against - the *stored* document cannot be, because four of the five ways a
 * person files a proposal write the proposal's own data onto the target in the
 * same batch, so the stored document already agrees with the revision and every
 * such row would read "the entry already contains this".
 *
 * `changedAt` is when the target last actually moved, which is what answers
 * "has this proposal fallen behind". A revision written pending and approved
 * weeks later changed the entry on its review date, not on the day it was
 * drafted - and `applyRevision` writes `review_time` without ever touching
 * `update_time`. The ~40k pipeline revisions approved as they were written
 * carry no `review_time`, which is what the fallback is for.
 */
async function readApprovedRevisions(
  db: Firestore,
  targets: Map<string, TargetInfo>,
): Promise<Map<string, ApprovedRevision>> {
  const ids = [
    ...new Set(
      [...targets.values()]
        .map((target) => target.approvedId)
        .filter((id): id is string => !!id),
    ),
  ];
  if (ids.length === 0) return new Map();

  const snapshots = await db.getAll(
    ...ids.map((id) => db.collection("revisions").doc(id)),
  );

  const approved = new Map<string, ApprovedRevision>();
  ids.forEach((id, index) => {
    const snapshot = snapshots[index];
    if (!snapshot?.exists) return;
    approved.set(id, {
      data: (snapshot.get("data") ?? {}) as Record<string, unknown>,
      changedAt:
        normalizeUpdateTime(snapshot.get("review_time")) ??
        normalizeUpdateTime(snapshot.get("update_time")),
    });
  });
  return approved;
}

/** The nodes at each end of every edge revision on this page.
 *
 * An edge has no name worth reading - `name` on one is a job title, which says
 * nothing about who holds it - and no page of its own. Both ends are read here
 * so a relation can be called what it is, and linked to the entry it will show
 * up on. The stored edge is the fallback for a revision that only changes a
 * date and so carries neither endpoint.
 */
async function readEdgeEndpoints(
  db: Firestore,
  docs: (QueryDocumentSnapshot | DocumentSnapshot)[],
  targets: Map<string, TargetInfo>,
): Promise<Map<string, EndpointInfo>> {
  const wanted = new Set<string>();
  for (const doc of docs) {
    const revision = doc.data() ?? {};
    if (revisionCollection(revision) !== "edges") continue;
    const id = targetIdOf(doc);
    const stored = (id && targets.get(targetKey("edges", id))?.data) || {};
    const proposed = (revision.data ?? {}) as Record<string, unknown>;
    for (const end of ["source", "target"] as const) {
      const node = stringField(proposed, end) ?? stringField(stored, end);
      if (node) wanted.add(node);
    }
  }

  const ids = [...wanted];
  if (ids.length === 0) return new Map();

  const snapshots = await db.getAll(
    ...ids.map((id) => db.collection("nodes").doc(id)),
    { fieldMask: ["name", "type"] },
  );

  const endpoints = new Map<string, EndpointInfo>();
  ids.forEach((id, index) => {
    const snapshot = snapshots[index];
    if (!snapshot?.exists) return;
    const name = stringField(snapshot.data() ?? {}, "name") ?? null;
    const raw = stringField(snapshot.data() ?? {}, "type");
    const type =
      raw && (nodeTypes as readonly string[]).includes(raw)
        ? (raw as NodeType)
        : null;
    endpoints.set(id, {
      id,
      name,
      type,
      path: type ? generateEntityUrl(type, id, name ?? undefined) : null,
    });
  });
  return endpoints;
}

async function readAuthors(uids: unknown[]): Promise<Map<string, AuthorInfo>> {
  const wanted = [
    ...new Set(uids.filter((uid): uid is string => typeof uid === "string")),
  ];
  const found = new Map<string, AuthorInfo>();

  for (let i = 0; i < wanted.length; i += AUTH_LOOKUP_CHUNK) {
    const chunk = wanted.slice(i, i + AUTH_LOOKUP_CHUNK);
    const result = await getAuth().getUsers(chunk.map((uid) => ({ uid })));
    for (const user of result.users) {
      found.set(user.uid, {
        displayName: user.displayName ?? null,
        email: user.email ?? null,
        photoURL: user.photoURL ?? null,
      });
    }
  }
  return found;
}

/** A revision's target id.
 *
 * `node_id` is what every writer sets, whatever the target is; `nodeId` is the
 * camel-cased variant a handful of older documents carry, which
 * `/api/revisions/byNode` also has to query both ways round for.
 */
export function targetIdOf(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
): string | null {
  const underscore = doc.get("node_id");
  if (typeof underscore === "string" && underscore) return underscore;
  const camel = doc.get("nodeId");
  return typeof camel === "string" && camel ? camel : null;
}

function describeOne(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  ctx: Context,
): Proposal {
  const revision = doc.data() ?? {};
  const collection = revisionCollection(revision);
  const targetId = targetIdOf(doc) ?? "";
  const target = ctx.targets.get(targetKey(collection, targetId));
  const approvedId = target?.approvedId;
  const approved = approvedId ? ctx.approved.get(approvedId) : undefined;

  const proposed = (revision.data ?? {}) as Record<string, unknown>;
  const kind = proposalKind(proposed, approvedId);
  const changes =
    kind === "removal"
      ? []
      : revisionChanges(proposed, baselineFor(doc.id, target, approved));

  const { status, derived } = resolveProposalStatus({
    id: doc.id,
    status: revision.status,
    approvedId,
  });

  const updateTime = normalizeUpdateTime(revision.update_time);
  const updateUser =
    typeof revision.update_user === "string" ? revision.update_user : "";
  const ends = edgeEnds(proposed, target, collection, ctx.endpoints);

  return {
    id: doc.id,
    targetId,
    targetCollection: collection,
    targetName: targetName(proposed, target, ends),
    targetType: targetType(proposed, target),
    targetPath: targetPath(proposed, target, collection, targetId, ends),
    targetExists: target?.exists ?? false,
    published: pageIsPublic(target?.data ?? {}),
    kind,
    deleteReason:
      typeof proposed.delete_reason === "string"
        ? proposed.delete_reason
        : null,
    changes: ctx.allChanges ? changes : changes.slice(0, MAX_INLINE_CHANGES),
    changeCount: changes.length,
    updateTime,
    updateUser,
    author: ctx.authors ? (ctx.authors.get(updateUser) ?? null) : null,
    automatic: revision.update_automatic === true,
    status,
    statusDerived: derived,
    rejectReason:
      typeof revision.reject_reason === "string"
        ? revision.reject_reason
        : null,
    reviewTime: normalizeUpdateTime(revision.review_time),
    // Only where authors are resolved: which reviewer turned a proposal down is
    // the reviewing side's business, and the author's own view says
    // `redakcja` for it - see `/api/revisions/mine`.
    reviewUser: ctx.authors
      ? (stringField(revision, "review_user") ?? null)
      : null,
    stale: isStale(doc.id, updateTime, approvedId, approved),
  };
}

/**
 * What a proposal is a change *to*.
 *
 * Not the stored document. `/api/revisions/create` writes a brand new node from
 * the revision's own data in the batch that files the revision, and
 * `createRevisionTransaction` - behind every relation a reader adds - writes the
 * target unconditionally. In both cases the stored document already says exactly
 * what the pending revision says, so diffing against it returns nothing and the
 * row reads "Wpis już to zawiera" for a proposal that is entirely new.
 *
 * The approved revision is the honest baseline: it is the version the entry is
 * actually serving. With nothing approved there is no previous version at all,
 * so every field the proposal states is new.
 */
function baselineFor(
  id: string,
  target: TargetInfo | undefined,
  approved: ApprovedRevision | undefined,
): Record<string, unknown> {
  if (!target?.approvedId) return {};
  // This revision *is* the approved one, so there is nothing to compare it
  // against but itself - and the stored document is that same snapshot.
  if (target.approvedId === id) return withoutInternalFields(target.data);
  return approved ? withoutInternalFields(approved.data) : {};
}

function proposalKind(
  proposed: Record<string, unknown>,
  approvedId: string | undefined,
): ProposalKind {
  if (proposed.deleted === true) return "removal";
  // Nothing has ever been approved onto the target, so there is no previous
  // version for this to be a change *to* and every field it carries is new.
  // That covers both a brand new entry and the second proposal against one
  // nobody has reviewed yet - in both cases a field-by-field diff against a
  // draft nobody stands behind would be reading the wrong baseline.
  return approvedId ? "edit" : "create";
}

/** Whether approving this would write over something newer.
 *
 * True only when the entry moved *after* this proposal was filed - and "moved"
 * means when the approved revision landed on the target, not when it was
 * drafted. Approving is what changes the entry, and a revision drafted in June
 * and approved in August overwrote whatever was proposed in July. Equal
 * timestamps are not stale: a revision approved in the batch that wrote it
 * shares its instant.
 */
function isStale(
  id: string,
  updateTime: string | null,
  approvedId: string | undefined,
  approved: ApprovedRevision | undefined,
): boolean {
  if (!approvedId || approvedId === id || !updateTime) return false;
  const changedAt = approved?.changedAt;
  return !!changedAt && changedAt > updateTime;
}

/** The nodes an edge revision joins, resolved for this page. Empty for a node
 * revision, and either half may be missing when the node cannot be read. */
function edgeEnds(
  proposed: Record<string, unknown>,
  target: TargetInfo | undefined,
  collection: "nodes" | "edges",
  endpoints: Map<string, EndpointInfo>,
): { source?: EndpointInfo; target?: EndpointInfo } {
  if (collection !== "edges") return {};
  const stored = target?.data ?? {};
  const sourceId =
    stringField(proposed, "source") ?? stringField(stored, "source");
  const targetId =
    stringField(proposed, "target") ?? stringField(stored, "target");
  return {
    source: sourceId ? endpoints.get(sourceId) : undefined,
    target: targetId ? endpoints.get(targetId) : undefined,
  };
}

/** What to call the thing a proposal is about.
 *
 * For a node, the proposal's own `name` wins over the stored one: a rename is
 * exactly the change most likely to be under review, and both the reviewer and
 * the author should read the name that is being proposed.
 *
 * An edge carries a `name` too, but it is a job title - "Członek zarządu" says
 * nothing about who holds it or where - so a relation is named after the two
 * entries it joins. That also makes the queue agree with the email
 * `revisionNotifications` sends about the same proposal, which already resolves
 * the node at the source.
 */
function targetName(
  proposed: Record<string, unknown>,
  target: TargetInfo | undefined,
  ends: { source?: EndpointInfo; target?: EndpointInfo },
): string | null {
  const stored = target?.data ?? {};
  const own = stringField(proposed, "name") ?? stringField(stored, "name");

  if (!ends.source && !ends.target) return own ?? null;

  const left = ends.source?.name ?? ends.source?.id;
  const right = ends.target?.name ?? ends.target?.id;
  const joined = left && right ? `${left} → ${right}` : (left ?? right);
  if (!joined) return own ?? null;
  // The job title still says which relation of the two, so it is kept - as a
  // qualifier rather than as the whole of the label.
  return own ? `${joined} (${own})` : joined;
}

function targetType(
  proposed: Record<string, unknown>,
  target: TargetInfo | undefined,
): NodeType | null {
  const raw =
    stringField(proposed, "type") ?? stringField(target?.data ?? {}, "type");
  return raw && (nodeTypes as readonly string[]).includes(raw)
    ? (raw as NodeType)
    : null;
}

/** The page to send a reader to, or null when there is not one.
 *
 * An edge has no page of its own, so a relation links to the entry at its
 * source - which is the page it will show up on, and the one the notification
 * email already points its author at. A target that no longer exists has no
 * page either; both would otherwise render as a link into a 404, which reads as
 * a bug rather than as the state of the data.
 */
function targetPath(
  proposed: Record<string, unknown>,
  target: TargetInfo | undefined,
  collection: "nodes" | "edges",
  targetId: string,
  ends: { source?: EndpointInfo; target?: EndpointInfo },
): string | null {
  if (collection === "edges") return ends.source?.path ?? null;
  if (!target?.exists || !targetId) return null;
  const type = targetType(proposed, target);
  if (!type) return null;
  const name =
    stringField(proposed, "name") ?? stringField(target.data, "name");
  return generateEntityUrl(type, targetId, name ?? undefined);
}

function stringField(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
