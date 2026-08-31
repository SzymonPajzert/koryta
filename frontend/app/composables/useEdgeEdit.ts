import { computed, ref, type Ref } from "vue";
import type { NodeType, Edge, Link } from "~~/shared/model";
import { edgeTypeOptions, type edgeTypeExt } from "./useEdgeTypes";
import { authRequest } from "./auth";

export type InternalEdge = Partial<Edge> & {
  direction?: "outgoing" | "incoming";
  richNode?: {
    id: string;
    type: NodeType;
    name: string;
  };
};

export type NodeRef = {
  id?: string;
  type: NodeType;
  ref: Ref<Link<NodeType> | undefined>;
};

interface UseEdgeEditOptions {
  fixedNode?: NodeRef; // The node we are "on" (context)
  referenceNode?: NodeRef; // Optional node reference for article mode
  edgeType: edgeTypeExt;
  initialDirection?: "incoming" | "outgoing";
  editedEdge?: string;
  onUpdate: () => Promise<void>;
}

/** The form behind "dodaj powiązanie": which node goes on which end of the new
 * edge, and what to POST once both ends are known.
 *
 * The edge is written as a proposal - `/api/edges/create` stores it without a
 * `revision_id`, which is what `pageIsPublic` reads - so it shows up for logged
 * in users straight away and for everyone else once a reviewer approves it.
 */
export function useEdgeEdit({
  fixedNode,
  referenceNode,
  edgeType = "connection",
  initialDirection,
  editedEdge,
  onUpdate = async () => {},
}: Partial<UseEdgeEditOptions>) {
  const newEdge = ref<InternalEdge>(emptyEdge(initialDirection));
  const internalEdgeType = ref<edgeTypeExt>(edgeType);
  const currentOption = computed(() => edgeTypeOptions[internalEdgeType.value]);

  const saving = ref(false);
  const error = ref<string | null>(null);

  /** Whether the node the form was opened on sits on this end of the edge.
   *
   * Direction says which end that is - "outgoing" means the page's node is the
   * source - and the type has to agree, so that opening the employment form on
   * a company puts the company on the employer end rather than the employee's.
   */
  const matches = (position: "source" | "target") => {
    const expectedPosition =
      newEdge.value.direction === "incoming" ? "target" : "source";
    if (position !== expectedPosition) return false;

    const expectedType =
      position === "source"
        ? currentOption.value.sourceType
        : currentOption.value.targetType;
    return fixedNode?.type === expectedType;
  };

  const layout = {
    source: {
      id: computed(() => (matches("source") ? fixedNode?.id : undefined)),
      type: computed(() => currentOption.value.sourceType),
      ref: ref<Link<NodeType> | undefined>(undefined),
    },
    target: {
      id: computed(() => (matches("target") ? fixedNode?.id : undefined)),
      type: computed(() => currentOption.value.targetType),
      ref: ref<Link<NodeType> | undefined>(undefined),
    },
  };

  /** Whichever end the user is filling in, for callers that do not care which
   * of the two it is. */
  const pickedNode = computed({
    get: () => {
      if (matches("source")) return layout.target.ref.value;
      if (matches("target")) return layout.source.ref.value;
      return undefined;
    },
    set: (val) => {
      if (matches("source")) layout.target.ref.value = val;
      else if (matches("target")) layout.source.ref.value = val;
    },
  });

  const sourceId = computed(
    () => layout.source.ref.value?.id ?? layout.source.id.value,
  );
  const targetId = computed(
    () => layout.target.ref.value?.id ?? layout.target.id.value,
  );

  /** No edge from a node to itself: the pickers offer every node of the right
   * type, including the one the form was opened on. */
  const isSelfEdge = computed(
    () => !!sourceId.value && sourceId.value === targetId.value,
  );

  const readyToSubmit = computed(
    () => !!sourceId.value && !!targetId.value && !isSelfEdge.value,
  );

  const edgeLabel = computed(() => currentOption.value.label);

  async function processEdge() {
    if (!readyToSubmit.value || saving.value) return;

    error.value = null;
    saving.value = true;
    try {
      // An edit revises the document that is already there rather than writing
      // a second one - /api/edges/create only ever adds, so posting there would
      // silently duplicate the relation. What may change is what the relation
      // says; its two ends and its type are fixed, which is why the pickers
      // above are read-only in this mode.
      if (editedEdge) {
        await authRequest<{ id: string }>("/api/edges/update", {
          method: "POST",
          body: {
            edge_id: editedEdge,
            name: newEdge.value.name,
            content: newEdge.value.content,
            start_date: newEdge.value.start_date,
            end_date: newEdge.value.end_date,
            party: newEdge.value.party,
            committee: newEdge.value.committee,
            position: newEdge.value.position,
            elected: newEdge.value.elected,
            term: newEdge.value.term,
            by_election: newEdge.value.by_election,
          },
        });
        await onUpdate();
        return;
      }

      const reference = referenceNode?.ref.value?.id;
      await authRequest<{ id: string }>("/api/edges/create", {
        method: "POST",
        body: {
          source: sourceId.value,
          target: targetId.value,
          type: currentOption.value.realType,
          name: newEdge.value.name,
          content: newEdge.value.content,
          start_date: newEdge.value.start_date,
          end_date: newEdge.value.end_date,
          references: [
            ...(newEdge.value.references || []),
            ...(reference ? [reference] : []),
          ],
          party: newEdge.value.party,
          committee: newEdge.value.committee,
          position: newEdge.value.position,
          elected: newEdge.value.elected,
          term: newEdge.value.term,
          by_election: newEdge.value.by_election,
        },
      });
      await onUpdate();
    } catch (e: unknown) {
      error.value = errorMessage(e);
    } finally {
      saving.value = false;
    }
  }

  /** The relation types that can be added from this node, in this direction. */
  const availableEdgeTypes = computed(() => {
    if (!fixedNode) return [];
    return Object.values(edgeTypeOptions).filter((option) => {
      const direction = newEdge.value.direction || "outgoing";
      if (
        option.allowedDirections &&
        !option.allowedDirections.includes(direction)
      ) {
        return false;
      }
      return direction === "outgoing"
        ? option.sourceType === fixedNode.type
        : option.targetType === fixedNode.type;
    });
  });

  function openEditEdge(edge: Edge) {
    const internalEdge = edge as InternalEdge;
    newEdge.value = { ...internalEdge };

    if (fixedNode?.id) {
      if (edge.source === fixedNode.id) {
        newEdge.value.direction = "outgoing";
      } else if (edge.target === fixedNode.id) {
        newEdge.value.direction = "incoming";
      }
    }

    // `owns` is stored once but offered as three separate options, told apart
    // by who is at the other end. A region at the other end is now a
    // shareholder rather than the seat - the seat has its own type.
    if (edge.type === "owns") {
      if (internalEdge.richNode?.type === "region") {
        internalEdgeType.value = "owns_region";
      } else if (edge.source === fixedNode?.id) {
        internalEdgeType.value = "owns_child";
      } else {
        internalEdgeType.value = "owns_parent";
      }
    } else if (edge.type === "seat") {
      internalEdgeType.value = "seat_region";
    } else {
      internalEdgeType.value = edge.type as edgeTypeExt;
    }

    const other = internalEdge.richNode;
    if (matches("source")) {
      layout.target.ref.value = {
        id: edge.target,
        type: layout.target.type.value,
        name: other?.name ?? "",
      };
    } else if (matches("target")) {
      layout.source.ref.value = {
        id: edge.source,
        type: layout.source.type.value,
        name: other?.name ?? "",
      };
    }
  }

  return {
    newEdge,
    edgeType: internalEdgeType,
    edgeLabel,
    layout,
    readyToSubmit,
    isSelfEdge,
    availableEdgeTypes,
    pickedNode,
    saving,
    error,
    // Methods
    processEdge,
    openEditEdge,
  };
}

function emptyEdge(direction?: "incoming" | "outgoing"): InternalEdge {
  return {
    type: "connection",
    target: "",
    name: "",
    content: "",
    start_date: "",
    end_date: "",
    direction: direction ?? "outgoing",
    references: [],
    elected: false,
    by_election: false,
  };
}

/** What the server said went wrong, when it said anything at all. */
function errorMessage(e: unknown): string {
  const data =
    typeof e === "object" && e !== null
      ? (e as { data?: { message?: string; statusMessage?: string } }).data
      : undefined;
  return (
    data?.message ||
    data?.statusMessage ||
    (e instanceof Error ? e.message : "") ||
    "Nie udało się zapisać powiązania."
  );
}
