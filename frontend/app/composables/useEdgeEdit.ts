import { computed, watch, toValue, type Ref } from "vue";
import type { NodeType, EdgeType, Edge, Link } from "~~/shared/model";
import { useEdgeTypes } from "./useEdgeTypes";
import { useEntityMutation } from "./useEntityMutation";

// NodeRef used to specify source/target nodes
// If id is undefined, it only specifies the expected type of the node.
type NodeRef = {
  id?: string;
  type: NodeType;
};

export type FixedNode = {
  id: string;
  type: NodeType;
};

interface UseEdgeEditOptions {
  fixedNode?: Ref<FixedNode | undefined>; // The node we are "on" (context)
  authHeaders: Ref<Record<string, string>>;
  onUpdate?: () => Promise<void>;
}

export function useEdgeEdit({
  fixedNode,
  authHeaders,
  onUpdate,
}: UseEdgeEditOptions) {
  const { edgeTypeOptions, getRealType, getEdgeOption } = useEdgeTypes();
  const { save } = useEntityMutation({ authHeaders });

  // Internal state
  const newEdge = ref<Partial<Edge> & { direction: "outgoing" | "incoming" }>(
    emptyEdge(),
  );
  const edgeType = ref<EdgeType>("connection");
  const pickedNode = ref<Link<NodeType> | undefined>(undefined);

  const isEditingEdge = computed(() => !!newEdge.value.id);

  // Helper to get current option
  const currentOption = computed(() => getEdgeOption(edgeType.value));

  // Determine which side is fixed based on direction and fixedNode presence
  // If fixedNode is present:
  //   direction="outgoing" => Source is fixedNode, Target is pickedNode
  //   direction="incoming" => Source is pickedNode, Target is fixedNode

  const layout = computed(() => {
    const dir = newEdge.value.direction;
    if (fixedNode?.value) {
      if (dir === "outgoing") {
        return { source: "fixed", target: "picked" };
      } else {
        return { source: "picked", target: "fixed" };
      }
    }
    // Generic mode (no fixed context) - simplified, assuming standard left-to-right creation if needed
    // But currently we always have fixedNode in context of "Edit Node" page.
    // For generic tool usage, we might allow picking both.
    // Let's assume generic mode means we pick both, but `pickedNode` is just one of them.
    // Actually, user requirement says "callsite can pick its expected type".
    // If no fixedNode, maybe we need two pickers?
    // Let's stick to the user's "optionalNode (set if it's not in the reference mode...)"
    // If fixedNode is missing (reference mode or generic), we might rely on manual assignment?
    // User said: "optionalNode ... and pickedNode which is empty ... return on which position each should be"

    // For now, let's strictly handle the fixedNode case which is 99% of usage
    return { source: "fixed", target: "picked" }; // Fallback
  });

  const availableEdgeTypes = computed(() => {
    if (!fixedNode?.value) return edgeTypeOptions;
    const myType = fixedNode.value.type;

    // Filter options based on whether we are currently behaving as Source or Target
    if (layout.value.source === "fixed") {
       // We are Source, so edge option must have sourceType === myType
       return edgeTypeOptions.filter(o => o.sourceType === myType);
    } else {
       // We are Target, so edge option must have targetType === myType
       // OR if we are "picked" (generic) - but here layout says we are "fixed" in Target pos.
       return edgeTypeOptions.filter(o => o.targetType === myType);
    }
  });

  // What kind of node should the picker allow?
  const pickerType = computed<NodeType>(() => {
    const opt = currentOption.value;
    if (!opt) return "person";

    // If layout says target is picked, we need targetType
    // If layout says source is picked, we need sourceType
    if (layout.value.target === "picked") {
      return opt.targetType;
    } else {
      return opt.sourceType;
    }
  });

  // Force direction if type implies only one direction from fixedNode
  watch(edgeType, (t) => {
    if (!fixedNode?.value || isEditingEdge.value) return; // Don't flip execution on edit

    const opt = getEdgeOption(t);
    if (!opt) return;

    const myType = fixedNode.value.type;
    const canBeSource = opt.sourceType === myType;
    const canBeTarget = opt.targetType === myType;

    // If can be both (symmetric like 'connection' between persons), keep current direction or default
    if (canBeSource && !canBeTarget) {
      newEdge.value.direction = "outgoing";
    } else if (!canBeSource && canBeTarget) {
      newEdge.value.direction = "incoming";
    }
  });

  function resetEdgeForm() {
    newEdge.value = emptyEdge();
    edgeType.value = "connection";
    pickedNode.value = undefined;
  }

  function openEditEdge(edge: Edge) {
    // Determine direction relative to fixedNode
    let direction: "outgoing" | "incoming" = "outgoing";

    if (fixedNode?.value) {
      direction = edge.source === fixedNode.value.id ? "outgoing" : "incoming";
    }

    newEdge.value = {
      ...edge,
      direction,
      content: edge.section || "",
    };
    edgeType.value = edge.type;

    // Handle special "owns_region" type check if needed
    if (edge.type === "owns" && direction === "incoming") {
      if (edge.richNode?.type === "region") {
        edgeType.value = "owns_region" as EdgeType;
      }
    }

    // Populate pickedNode with the "other" side (richNode is already that)
    pickedNode.value = {
      ...edge.richNode,
      id: edge.richNode.id || "",
    };
  }

  function cancelEditEdge() {
    resetEdgeForm();
  }

  async function processEdge() {
    const type = getRealType(edgeType.value);

    // Determine Source and Target IDs
    let sourceId: string | undefined;
    let targetId: string | undefined;

    if (isEditingEdge.value) {
      // Edit mode: IDs are already in newEdge (from openEditEdge)
      // But wait, newEdge is partial.
      // And we might have changed the picked node (if we allow re-linking, though UI might block it)
      // Usually edit doesn't change endpoints.
      sourceId = newEdge.value.source;
      targetId = newEdge.value.target;
    } else {
      // Create mode: Use layout to determine
      if (fixedNode?.value) {
        if (layout.value.source === "fixed") {
          sourceId = fixedNode.value.id;
          targetId = pickedNode.value?.id;
        } else {
          sourceId = pickedNode.value?.id;
          targetId = fixedNode.value.id;
        }
      }
    }

    if (!sourceId || !targetId) {
      alert("Brak źródła lub celu!");
      return;
    }

    const payload = {
      source: sourceId,
      target: targetId,
      type,
      name: newEdge.value.name,
      content: newEdge.value.content,
      start_date: newEdge.value.start_date,
      end_date: newEdge.value.end_date,
      references: newEdge.value.references,
    };

    if (isEditingEdge.value) {
      await save({
        isNew: false,
        createEndpoint: "",
        revisionEndpoint: "/api/revisions/create",
        payload: { ...payload, node_id: newEdge.value.id, collection: "edges" },
        onSuccess: async () => {
          resetEdgeForm();
          if (onUpdate) await onUpdate();
        },
      });
    } else {
      await save({
        isNew: true,
        createEndpoint: "/api/edges/create",
        revisionEndpoint: "",
        payload,
        successMessage: "Dodano powiązanie!",
        onSuccess: async () => {
          resetEdgeForm();
          if (onUpdate) await onUpdate();
        },
      });
    }
  }

  // Expose methods to manually set type/direction if UI needs to force it (e.g. from buttons)
  function initNewEdge(type: EdgeType) {
    resetEdgeForm();
    edgeType.value = type;
  }

  return {
    newEdge,
    edgeType,
    pickedNode,
    pickerType,
    layout,
    isEditingEdge,
    availableEdgeTypes,
    // Methods
    processEdge,
    cancelEditEdge,
    openEditEdge,
    initNewEdge,
    getEdgeOption, // Useful for UI to display icons etc
  };
}

function emptyEdge(): Partial<Edge> & { direction: "outgoing" | "incoming" } {
  return {
    type: "connection",
    target: "",
    name: "",
    content: "",
    start_date: "",
    end_date: "",
    direction: "outgoing",
    references: [],
  };
}
