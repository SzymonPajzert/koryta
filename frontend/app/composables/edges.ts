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
  source: string;
  target: string;
  id?: string;
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

  const sources = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (edges.value || [])
      .filter((e: Edge) => e.target == id && nodes.value[e.source])
      .map((e: Edge) => ({
        ...e,
        label: e.name || edgeTypeLabels[e.type] || e.type,
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
        label: e.name || edgeTypeLabels[e.type] || e.type,
        richNode: {
          ...nodes.value[e.target],
          type: nodes.value[e.target]?.entityType,
        } as Node,
      }));
  });
  const referencedIn = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (edges.value || [])
      .filter((e: Edge) => e.references?.includes(id))
      .map((e: Edge) => ({
        ...e,
        label: e.name || edgeTypeLabels[e.type] || e.type,
        richNode: {
          ...nodes.value[e.source],
          type: nodes.value[e.source]?.entityType,
        } as Node, // We show source node for referenced edges
      }));
  });

  async function refresh() {
    await refreshLocal();
  }

  return { sources, targets, referencedIn, refresh };
}
