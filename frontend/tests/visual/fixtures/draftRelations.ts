import type { GraphLayout } from "../../../shared/graph/util";
import type { Node, NodeStats } from "../../../shared/graph/model";
import { NODE_COLORS } from "../../../shared/graph/nodes";

/** A stand-in for `/api/graph/local/[id]`, for the visual capture of the
 * „szkic" badge on a relation - `ChipEdgeDraftStatus`.
 *
 * WHY A FIXTURE AND NOT THE SEED. The badge only draws on a relation that is
 * not published, and `scripts/edges.json` contains exactly one: Anna Nowak to
 * Orlen. Nothing in this suite photographs it, and putting it on a surface that
 * is photographed is the one thing `tests/e2e/publish_relation.spec.ts` goes
 * out of its way not to do - a draft relation left on /entity/person/1 or /3
 * turns notes.spec.ts and person-facts.spec.ts red for a reason that has
 * nothing to do with either. Seeding a fourth person instead would move the
 * node counts that the home page, the progress bar and /eksploruj/statystyki
 * all print. A route handler moves nothing: it answers this page in this
 * browser context and no other.
 *
 * WHAT IT IS SHAPED FOR. The three states the badge has, in one picture:
 *
 *   - a draft relation between two live pages - the chip *and* „Opublikuj",
 *     which is the case the component was written for;
 *   - a draft relation whose far end is itself a draft - the chip alone, since
 *     the only thing a button there could produce is the refusal
 *     /api/edges/publish owes it;
 *   - a published relation - nothing at all, which is the rule rather than the
 *     exception and is why a green „opublikowane" chip on every other row
 *     would be the wrong way round.
 *
 * NO DATES ON ANY OF THEM, deliberately. `ChipRelativeDuration` scales its
 * track against `maxEnd`, which is `new Date()` - a dated row would repaint
 * every day and leave this baseline drifting the way instytucja-strona's does.
 * Undated rows drop the track and keep the shot about the badge.
 */

const stats: NodeStats = { people: 1 };

function company(
  id: string,
  name: string,
  visibility: boolean,
): Node & {
  stats: NodeStats;
} {
  return {
    id,
    name,
    entityType: "place",
    type: "rect",
    color: NODE_COLORS.place,
    visibility,
    stats,
  };
}

export function draftRelationsGraph(subjectId: string): GraphLayout {
  const live = "visdraftlive";
  const unpublishedEnd = "visdraftszkic";
  const published = "visdraftopub";

  return {
    nodes: {
      [subjectId]: {
        id: subjectId,
        name: "Jan Kowalski",
        entityType: "person",
        type: "circle",
        color: NODE_COLORS.person,
        visibility: true,
        stats,
      },
      [live]: company(live, "Spółka Opublikowana", true),
      [unpublishedEnd]: company(
        unpublishedEnd,
        "Spółka w Przygotowaniu",
        false,
      ),
      [published]: company(published, "Spółka Zatwierdzona", true),
    },
    edges: [
      // Both ends live, the relation is not: chip + „Opublikuj".
      {
        id: "visdraftedgelive",
        source: subjectId,
        target: live,
        type: "employed",
        name: "członek rady nadzorczej",
        visibility: false,
      },
      // The far end is a draft: chip, no button.
      {
        id: "visdraftedgeszkic",
        source: subjectId,
        target: unpublishedEnd,
        type: "employed",
        name: "prezes zarządu",
        visibility: false,
      },
      // Published: the badge draws nothing, which is what the third row is
      // here to prove.
      {
        id: "visdraftedgeopub",
        source: subjectId,
        target: published,
        type: "employed",
        name: "prokurent",
        visibility: true,
      },
    ],
    nodeGroups: [],
  };
}
