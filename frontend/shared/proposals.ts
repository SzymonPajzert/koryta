/** A revision as the two people who care about it need to read it: the
 * reviewer working through a queue, and the contributor waiting for an answer.
 *
 * Both surfaces render the same row from the same type, because they are
 * looking at the same object and a contributor who is told `Zatwierdzona` while
 * the reviewer sees `Oczekuje` has been lied to by a rendering difference.
 */

import type { NodeType, RevisionStatus } from "./model";
import type { RevisionChange } from "./revisionChanges";

/** Where a proposal stands, once the stored `status` has been reconciled with
 * what its target actually points at.
 *
 * `superseded` is not a stored status and never will be: it is the state of a
 * revision that *was* approved and has since been overtaken by a newer one. It
 * has to be told apart from `approved`, because calling it approved on the
 * author's own page claims their words are on the site when they are not.
 */
export type ProposalStatus = RevisionStatus | "superseded";

export const proposalStatuses = [
  "pending",
  "approved",
  "superseded",
  "rejected",
] as const;

/** How each state reads, and in which colour. The vocabulary is lifted from
 * `/admin/rewizje/[id]`, which taught these four words first; only
 * `Zastąpiona` is new, because that page never distinguished it.
 *
 * The colours are the ink tokens from `shared/colors.ts`, not Vuetify's
 * `warning`/`success`/`grey`: a tonal chip paints its colour as the text, and
 * those three came out at 2.1-2.5:1 on their own tint - the word the chip
 * exists to say was the hardest thing on the row to read. The same token is
 * what a bare status icon is drawn in. */
export const proposalStatusLabels: Record<
  ProposalStatus,
  { label: string; color: string }
> = {
  pending: { label: "Oczekuje", color: "ink-warning" },
  approved: { label: "Zatwierdzona", color: "ink-success" },
  superseded: { label: "Zastąpiona", color: "ink-neutral" },
  rejected: { label: "Odrzucona", color: "ink-danger" },
};

/** Why a proposal is in the state it is in, for the reader who wonders. */
export const proposalStatusHints: Record<ProposalStatus, string> = {
  pending: "Czeka na decyzję redakcji.",
  approved: "Redakcja przyjęła tę wersję i to ona opisuje wpis.",
  superseded:
    "Ta wersja została przyjęta, ale wpis opisuje już nowsza rewizja.",
  rejected: "Redakcja nie przyjęła tej wersji.",
};

/**
 * What a proposal's state really is, from the revision and its target.
 *
 * The stored `status` is not enough on its own, in both directions:
 *
 * - **It is often absent.** 41,842 of the 44,544 revisions in production
 *   predate review entirely. `revisionIsPending` already documents that absent
 *   reads as pending, but a revision a node has since been pointed at is
 *   approved in every sense that matters and showing it as `Oczekuje` forever
 *   is the more misleading answer.
 * - **It goes stale.** `status: "approved"` is written once and never revisited,
 *   so the moment a newer revision is approved over it, the older one still
 *   claims to be the approved one. That is `superseded`.
 *
 * `approvedId` is the target's `revision_id` reduced to a bare id (see
 * `approvedRevisionId`), or undefined when the target has no approved revision
 * or could not be read.
 */
export function resolveProposalStatus(args: {
  id: string;
  status?: unknown;
  approvedId?: string;
}): { status: ProposalStatus; derived: boolean } {
  const isApproved = !!args.approvedId && args.approvedId === args.id;

  if (args.status === "rejected") return { status: "rejected", derived: false };

  if (args.status === "approved") {
    return isApproved
      ? { status: "approved", derived: false }
      : { status: "superseded", derived: true };
  }

  // Stored as pending, or carrying no status at all. Either way the target has
  // the last word: a node pointing at this revision is serving it, whatever the
  // revision says about itself.
  if (isApproved) return { status: "approved", derived: true };
  return { status: "pending", derived: args.status !== "pending" };
}

/** The three states a revision is *stored* in, which is what a filter names. */
export type StoredStatusFilter = RevisionStatus | "all";

/**
 * Whether a resolved status answers a filter written in stored terms.
 *
 * `superseded` has no stored form - it is `approved` plus the observation that
 * the target has moved on - so a reader asking for approved proposals means
 * both. Anything else matches its own name. Keeping the mapping here is what
 * lets the per-author path (which filters resolved statuses in memory) and the
 * aggregate path (which filters stored ones in Firestore) agree about what
 * `?status=approved` selects.
 */
export function matchesStoredStatus(
  resolved: ProposalStatus,
  filter: StoredStatusFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "approved")
    return resolved === "approved" || resolved === "superseded";
  return resolved === filter;
}

/** What a proposal is asking for, which decides how its row reads.
 *
 * A removal shown as `deleted: — → tak` buries the only thing about it that
 * matters, and a brand new entry diffed against an empty document shows every
 * field as changed, which is true but is not a diff.
 */
export type ProposalKind = "edit" | "create" | "removal";

/** One row of the review queue, of an entry's revision history, or of the
 * card on `/profil`. */
export interface Proposal {
  /** The revision id. Also the permalink key. */
  id: string;
  targetId: string;
  targetCollection: "nodes" | "edges";
  /** The node's name, or a relation described by the page at its source. Null
   * when the target is gone. */
  targetName: string | null;
  targetType: NodeType | null;
  /** Where to read the entry. Null for a relation, which has no page, and for a
   * target that no longer exists. */
  targetPath: string | null;
  /** Whether the target still exists. A proposal against a deleted entry can
   * never be approved onto anything and has to say so rather than render as a
   * dead link. */
  targetExists: boolean;
  /** Whether the target is live on the public site. */
  published: boolean;
  kind: ProposalKind;
  /** Only on a removal: why the author thinks the entry should go. */
  deleteReason: string | null;
  /** Capped at `MAX_INLINE_CHANGES` unless the endpoint asked for every field
   * (an entry's history does); `changeCount` is the number before the cap. */
  changes: RevisionChange[];
  changeCount: number;
  updateTime: string | null;
  updateUser: string;
  /** Resolved display data for the author. Withheld from the author's own view
   * of their proposals - they know who they are - and from anybody who is not
   * an admin, on the same terms as `/api/users/lookup`. */
  author: {
    displayName: string | null;
    email: string | null;
    photoURL: string | null;
  } | null;
  automatic: boolean;
  status: ProposalStatus;
  /** True when `status` was worked out from the target rather than read off the
   * revision, which is the case for every revision written before review
   * existed. The queue says so rather than presenting a guess as a record. */
  statusDerived: boolean;
  rejectReason: string | null;
  reviewTime: string | null;
  /** Who approved or rejected it, as a uid. Given on the same terms as
   * `author` - to admins only - and missing from rows built before it existed,
   * hence optional. Null on the pipeline revisions approved as they were
   * written, which nobody reviewed. */
  reviewUser?: string | null;
  /** The target changed after this proposal was filed, so approving it would
   * write an older snapshot over whatever landed since. `applyRevision` writes
   * with `set`, not `merge`, so this really does undo the newer edits - it is
   * the most expensive mistake available on the review screen.
   */
  stale: boolean;
}

/** How many changed fields a row shows before it says "and N more". Six fits a
 * table row on a laptop; past that a reviewer wants the full comparison. */
export const MAX_INLINE_CHANGES = 6;

/** Counts by state, for the summary chips on `/profil`. */
export type ProposalCounts = Record<ProposalStatus, number>;

export function emptyProposalCounts(): ProposalCounts {
  return { pending: 0, approved: 0, superseded: 0, rejected: 0 };
}
