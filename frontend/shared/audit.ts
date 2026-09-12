/** The decisions only an administrator can make, kept as their own record.
 *
 * Everything else a person does to the data leaves a document behind that says
 * who did it: a vote, a note, a revision. The two decisions that settle what
 * the public actually sees did not. Approving was written onto the revision
 * (`review_user`), which holds only the latest verdict — re-approving an older
 * version overwrites who chose the newer one — and publishing was written
 * nowhere at all, so `published` on a node said what the answer is and never
 * who gave it.
 *
 * So these go in a collection of their own, append-only. It is the history the
 * node cannot hold, and it is what shows two admins undoing each other rather
 * than leaving a flag that flipped for no visible reason.
 */
export const auditActions = [
  "approve",
  "reject",
  "publish",
  "unpublish",
  "delete",
  // Two people who were one page, and one person who was two. Both rewrite
  // relations across nodes rather than changing what a single page says, so
  // neither leaves a revision that explains where the graph moved to - the
  // node it moved off may not even be readable afterwards.
  "merge",
  "split",
  // An editor's verdict on one reader-awarded badge on one person
  // (server/api/nodes/[id]/badges.post.ts). One action for all three verdicts -
  // approved, hidden and cleared - rather than the two `publish`/`unpublish`
  // are, because the decision has three states and not two: a badge nobody has
  // ruled on is *absent* from `badgeModeration`, which is neither of the
  // others. Which of the three it was is in `badge.verdict` below, where a
  // reader of the log can compare it against the entry before it; the
  // publish/unpublish pair predates that field and keeps its shape.
  "badge",
] as const;

export type AuditAction = (typeof auditActions)[number];

export type AuditEntry = {
  action: AuditAction;
  /** Which collection `target_id` names — `node_id` on a revision holds the id
   * whether the target is a node or an edge, so it cannot be inferred. */
  collection: "nodes" | "edges";
  target_id: string;
  /** The revision approved or turned down. Absent for publish/unpublish, which
   * change who can see a page rather than what it says. */
  revision_id?: string;
  /** The admin's uid. */
  user: string;
  /** ISO 8601, UTC. A string rather than a Timestamp so the activity scan is a
   * plain range query on one field, the way votes and notes are read. */
  at: string;
  /** Why the suggestion was turned down, or why the entry was removed. Only a
   * rejection and a removal carry one. */
  reason?: string;
  /** Where a merged page's relations went, and which ones.
   *
   * A merge is the one action whose undo cannot be read back off the documents
   * it touched: a relation moved onto the surviving page is indistinguishable
   * from one that was always there, so nothing on either page says which of
   * them to hand back. Only the ids are kept - what each relation said is in
   * its own revisions, which the move leaves alone.
   */
  merge?: {
    into: string;
    moved: string[];
    collapsed: string[];
    /** Relations of the surviving page that were filled in from the
     * duplicate's poorer copy of the same fact, rather than left beside it. */
    enriched?: string[];
  };
  /** Which badge an editor ruled on, and how. Only a `badge` action carries it.
   *
   * The node keeps the answer and nothing else: `badgeModeration` is declared
   * `Record<string, "approved" | "hidden">` on `Person` (shared/model.ts) and
   * stays that way, so it holds no uid and no time, and a cleared verdict is
   * removed from the map outright. Without this field the log would say an
   * editor touched a person's badges and not which of the five, which is the
   * whole content of the decision - the badges on one person are ruled on
   * independently, and „Kot na cztery nogi” hidden is a different act from
   * „Społecznik” approved.
   */
  badge?: {
    id: string;
    /** `null` is written, not left out: an entry with no `verdict` key would be
     * indistinguishable from one filed before this field existed, and clearing
     * a wrong „hidden” is exactly the act somebody reads the log to find. */
    verdict: "approved" | "hidden" | null;
  };
};

/** Whether the action decides visibility rather than content, which is the cut
 * that matters when reading the log back: two admins disagreeing about whether
 * a page should be live is a different conflict from disagreeing about what it
 * should say.
 *
 * `badge` is deliberately not one of them, though it does decide what a reader
 * sees. It settles whether one chip stands next to a name, not whether the page
 * exists for the public - reading the two as the same kind would put „ukryto
 * odznakę Kot na cztery nogi” beside „ukryto stronę” in a list meant to show
 * two admins undoing each other over a whole page. */
export function isVisibilityAction(action: AuditAction): boolean {
  return action === "publish" || action === "unpublish";
}

export const auditActionLabels: Record<AuditAction, string> = {
  approve: "Zatwierdzenie rewizji",
  reject: "Odrzucenie rewizji",
  publish: "Opublikowanie strony",
  unpublish: "Ukrycie strony",
  delete: "Usunięcie wpisu",
  merge: "Scalenie duplikatu",
  split: "Rozdzielenie strony",
  // Covers all three verdicts, so it names the decision and not its outcome:
  // which way it went is in `badge.verdict`, and the panel that shows this
  // label has the entry beside it.
  badge: "Werdykt o odznace",
};
