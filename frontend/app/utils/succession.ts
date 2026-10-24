import type { PersonSuccession } from "~~/server/api/edges/successions.get";
import type { EdgeNode } from "~/composables/edges";
import { displayRole } from "~~/shared/companyBodies";
import type { Company } from "~~/shared/model";

/** Whoever held a seat before the spell an edge records, carrying how many
 * seats changed hands alongside it - which is what says whether naming this
 * one person asserts more than the register does. */
export type Predecessor = NonNullable<PersonSuccession["predecessor"]> & {
  batchSize: number;
};

/** The role two spells have to share to be the same seat, normalised the way
 * `shared/succession.ts` normalises it: case and surrounding space only. */
function seatRole(role: string | null | undefined): string {
  return role?.trim().toLowerCase() ?? "";
}

/** A spell's identity as far as the register is concerned: the company, the
 * seat, and the day it began. */
function seatKey(
  companyId: string,
  role: string | null | undefined,
  start: string | null | undefined,
): string {
  return `${companyId}|${seatRole(role)}|${start ?? ""}`;
}

/** Which of a person's relations was taken over from somebody, keyed by edge
 * id, for `card/EmploymentHistory.vue`'s per-row hint.
 *
 * The join has to be made here rather than read off the response, because
 * `/api/edges/successions?personId=` answers per *post* and never carries the
 * edge id of this person's own spell - only of the other side's. So a post is
 * matched back to the row it belongs to on what both hold: the company, the
 * role and the start date. That triple is what `shared/succession.ts` treats as
 * one seat, and a person holding the same seat twice from the same day would be
 * one spell filed twice, which the pairing already drops as a duplicate.
 *
 * The row's role is read the way the endpoint names its post, through
 * `displayRole`. A supervisory seat comes back from it under the organ's real
 * name, „Rada Społeczna" or „Komisja Rewizyjna", while the row still holds the
 * „Rada Nadzorcza" every such seat is stored as - so a hospital's or an
 * association's seat matched nothing, and its row never showed who held it
 * before.
 *
 * A post whose row is not in `edges` is skipped rather than guessed at: the
 * card is handed whatever the local graph returned, and that is not always
 * every relation the endpoint saw.
 */
export function predecessorsByEdge(
  posts: PersonSuccession[],
  edges: EdgeNode[],
): Record<string, Predecessor> {
  const rows = new Map<string, string>();
  for (const edge of edges) {
    if (!edge.id || edge.type !== "employed") continue;
    const company =
      edge.richNode.type === "place" ? (edge.richNode as Company) : undefined;
    const role = displayRole(edge.label, company);
    const key = seatKey(edge.target, role, edge.start_date);
    // First one wins, so two indistinguishable rows do not both claim the
    // handover and leave which of them shows it up to Firestore's ordering.
    if (!rows.has(key)) rows.set(key, edge.id);
  }

  const byEdge: Record<string, Predecessor> = {};
  for (const post of posts) {
    if (!post.predecessor) continue;
    const edgeId = rows.get(seatKey(post.companyId, post.role, post.start));
    if (edgeId) {
      byEdge[edgeId] = { ...post.predecessor, batchSize: post.batchSize };
    }
  }
  return byEdge;
}
