import type { Node, Edge, EdgeType, ElectionPosition } from "~~/shared/model";
import type { TraversePolicy } from "~~/shared/graph/model";

export type EdgeNode = {
  richNode: Node;
  type: EdgeType;
  /** What the row prints, which for a relation with no name of its own is the
   * edge type's Polish phrase - "Zatrudniony/a w" rather than a job title. */
  label: string;
  /** The relation's own name, as stored: the job title, the election. Distinct
   * from `label` above, which stands in for it when it is empty - anything
   * offering the value back for editing wants this one, or it would store the
   * fallback phrase as a real job title on the first save. */
  name?: string;
  /** The relation's name read from the far end - see `Edge.reverse_name`. As
   * stored, like `name`, and for the same reason: `label` has already chosen
   * between the two. */
  reverse_name?: string;
  source: string;
  target: string;
  id?: string;
  /** Which end of the relation the node these rows were read from sits on:
   * "outgoing" means it is the source. What decides which of the two names the
   * row prints, and which way round the correction dialog labels them. */
  direction?: "outgoing" | "incoming";
  /** The name of the node these rows were read from, so a dialog can name both
   * ends without the caller passing it down again. Absent where the local
   * graph did not return the centre - see `useEdges`. */
  subjectName?: string;
  traverse?: TraversePolicy;
  /** Article ids the relation is cited to, as the local graph returns them.
   * The names behind them are only fetched when somebody opens the sources
   * dialog - here it is the count that matters, so a claim with nothing behind
   * it can be told apart from one that is sourced. */
  references?: string[];
  start_date?: string;
  end_date?: string;
  party?: string;
  committee?: string;
  position?: ElectionPosition;
  elected?: boolean;
  term?: string;
  by_election?: boolean;
};

/** "1 powiązanie", "2 powiązania", "5 powiązań".
 *
 * Polish counts three ways, and the admin surfaces report counts often enough
 * that getting it wrong reads as machine-written every time. */
export function relationsPlural(count: number): string {
  if (count === 1) return "powiązanie";
  const tens = count % 100;
  const units = count % 10;
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return "powiązania";
  return "powiązań";
}

/** What a relation is called on screen, when it has no name of its own. Shared
 * with the admin views, which list edges outside any graph. */
export const edgeTypeLabels: Record<string, string> = {
  employed: "Zatrudniony/a w",
  owns: "Właściciel",
  seat: "Siedziba",
  connection: "Powiązanie z",
  mentions: "Wspomina o",
  comment: "Komentarz",
  election: "Kandydował/a w",
  tagged: "Dotyczy tematu",
};

/** What one row calls the relation, read from the end `direction` names.
 *
 * A `connection` is the only type whose word differs by end, and the only one
 * that stores a second. Where it has none - every relation added before the
 * field existed - this falls back to `name`, which is the behaviour that was
 * wrong on one of the two pages and is what /admin/relacje works through.
 */
export function edgeSideLabel(
  edge: Pick<Edge, "type" | "name" | "reverse_name">,
  direction: "outgoing" | "incoming",
): string {
  const own =
    direction === "incoming" ? edge.reverse_name || edge.name : edge.name;
  return own || edgeTypeLabels[edge.type] || edge.type;
}

export async function useEdges(nodeID: MaybeRefOrGetter<string | undefined>) {
  const { user } = useAuthState();
  const { data: localData, refresh: refreshLocal } = await authFetch(
    () => `/api/graph/local/${toValue(nodeID)}`,
    {
      query: computed(() => ({
        latest: !!user.value,
        distance: 1,
        center: toValue(nodeID),
      })),
      watch: [toRef(nodeID)],
    },
  );

  const nodes = computed(() => localData.value?.nodes || {});
  const edges = computed(() => localData.value?.edges || []);

  /** The page these rows belong to, as the local graph names it. The centre is
   * in the node map the edges were filtered against, so no second lookup. */
  const subjectName = computed(() => {
    const id = toValue(nodeID);
    return id ? nodes.value[id]?.name : undefined;
  });

  // The node this was asked about is the *target* of these, so each row is
  // read backwards and prints the relation's reverse name where it has one.
  const sources = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (edges.value || [])
      .filter((e: Edge) => e.target == id && nodes.value[e.source])
      .map((e: Edge) => ({
        ...e,
        label: edgeSideLabel(e, "incoming"),
        direction: "incoming" as const,
        subjectName: subjectName.value,
        richNode: {
          ...nodes.value[e.source],
          type: nodes.value[e.source]?.entityType,
        } as Node,
      }));
  });
  const targets = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (edges.value || [])
      .filter((e: Edge) => e.source == id && nodes.value[e.target])
      .map((e: Edge) => ({
        ...e,
        label: edgeSideLabel(e, "outgoing"),
        direction: "outgoing" as const,
        subjectName: subjectName.value,
        richNode: {
          ...nodes.value[e.target],
          type: nodes.value[e.target]?.entityType,
        } as Node,
      }));
  });
  const referencedIn = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (
      (edges.value || [])
        .filter((e: Edge) => e.references?.includes(id))
        // Neither end: this page is the article a relation is cited to, so it is
        // read from the source's side, the way the relation itself is written.
        .map((e: Edge) => ({
          ...e,
          label: edgeSideLabel(e, "outgoing"),
          richNode: {
            ...nodes.value[e.source],
            type: nodes.value[e.source]?.entityType,
          } as Node, // We show source node for referenced edges
        }))
    );
  });

  async function refresh() {
    await refreshLocal();
  }

  return { sources, targets, referencedIn, refresh };
}
