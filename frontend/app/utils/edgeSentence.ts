import type { EdgeNode } from "~/composables/edges";
import { relationPeriodLabel } from "~/utils/relationPeriod";

/** One relation read as a sentence: who, which relation, with whom, and when.
 *
 * The dialogs that act on a relation - its sources, its removal - are handed an
 * edge id and nothing else, and an id tells the reader nothing about which of
 * the rows they clicked. That matters most for the one that destroys it.
 *
 * `subject` is the page the relation is being read from, so the same edge reads
 * "Jan Kowalski – Zatrudniony/a w – Orlen" on his profile and
 * "Orlen – Zatrudniony/a w – Jan Kowalski" on the company's, with the period
 * as every relation's is printed (`relationPeriodLabel`).
 *
 * A util rather than part of `composables/edges`, because the pages that draw
 * relations mock that module wholesale in their component tests, and a pure
 * formatter has no business being on the far side of a mock.
 */
export function edgeSentence(
  subject: string | undefined,
  edge: EdgeNode | undefined,
): string {
  if (!edge) return "";
  const period = relationPeriodLabel(edge.start_date, edge.end_date);
  return [`${subject ?? ""} – ${edge.label} – ${edge.richNode.name}`, period]
    .filter(Boolean)
    .join(" · ");
}
