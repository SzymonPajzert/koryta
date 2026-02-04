import { computed, watch, ref, toValue, type Ref } from "vue";
import type { NodeType, EdgeType, Edge, Link } from "~~/shared/model";
import { useEdgeTypes } from "./useEdgeTypes";
import { useEntityMutation } from "./useEntityMutation";

interface UseEdgeEditOptions {
  nodeId: Ref<string | undefined>;
  nodeType: Ref<NodeType>;
  authHeaders: Ref<Record<string, string>>;
  onUpdate?: () => Promise<void>;
  stateKey?: Ref<string>; // Optional stateKey for shared state
}

export function useEdgeEdit({
  nodeId,
  nodeType: myType,
  authHeaders,
  onUpdate,
  stateKey = ref("global-edge-edit"),
}: UseEdgeEditOptions) {
  const { edgeTypeOptions, getRealType, getEdgeOption } = useEdgeTypes();
  const { save } = useEntityMutation({ authHeaders });

  // Determine the actual key string once
  const baseKey = toValue(stateKey);
  const newEdge = useState(`${baseKey}-newEdge`, emptyEdge);

  // TODO it shouldn't be a connection
  const edgeType = useState<EdgeType>(
    `${baseKey}-edgeType`,
    () => "connection",
  );

  // Sync edgeType -> newEdge.type
  watch(edgeType, (t) => {
    newEdge.value.type = t;
  });

  const pickerTarget = useState<Link<NodeType> | undefined>(
    `${baseKey}-pickerTarget`,
    () => undefined,
  );

  const pickerSource = useState<Link<NodeType> | undefined>(
    `${baseKey}-pickerSource`,
    () => undefined,
  );

  const isEditingEdge = computed(() => !!newEdge.value.id);

  const availableEdgeTypes = computed(() => {
    // Special handling for "article" mode (context mode)
    if (myType.value === "article") {
      let options = edgeTypeOptions;
      if (pickerSource.value) {
        options = options.filter(
          (o) => o.sourceType === pickerSource.value?.type,
        );
      }
      if (pickerTarget.value) {
        options = options.filter(
          (o) => o.targetType === pickerTarget.value?.type,
        );
      }
      return options;
    }

    const dir = newEdge.value.direction;
    return edgeTypeOptions.filter((o) => {
      if (dir === "outgoing") {
        const rs = o.sourceType;
        return rs === myType.value;
      } else {
        const rt = o.targetType;
        return rt === myType.value;
      }
    });
  });

  // Handle type selection -> enforce direction if needed
  watch(edgeType, (t) => {
    if (!isEditingEdge.value) {
      const option = getEdgeOption(t);
      if (option) {
        const canBeSource = option.sourceType === myType.value;
        const canBeTarget = option.targetType === myType.value;

        if (canBeSource && !canBeTarget) {
          newEdge.value.direction = "outgoing";
        } else if (!canBeSource && canBeTarget) {
          newEdge.value.direction = "incoming";
        }
      }
    }
  });

  // Handle direction switch -> validate type
  watch(
    () => newEdge.value.direction,
    (newDir) => {
      if (!isEditingEdge.value && myType.value !== "article") {
        pickerTarget.value = undefined;

        // Re-validate current edgeType
        const option = getEdgeOption(edgeType.value);
        let currentStillValid = false;
        if (option) {
          const rs = option.sourceType;
          const rt = option.targetType;
          if (newDir === "outgoing") {
            currentStillValid = rs === myType.value;
          } else {
            currentStillValid = rt === myType.value;
          }
        }

        if (!currentStillValid) {
          // Default to the first available type for the new direction
          const available = availableEdgeTypes.value;
          if (available[0]) {
            edgeType.value = available[0].realType;
          }
        }
      }
    },
    { deep: true },
  );

  const edgeSourceType = computed<NodeType>(() => {
    const option = getEdgeOption(edgeType.value);
    return option?.sourceType || "person";
  });

  const edgeTargetType = computed<NodeType>(() => {
    const option = getEdgeOption(edgeType.value);
    if (myType.value === "article") {
      return option?.targetType || "place";
    }

    const dir = newEdge.value.direction;
    if (dir === "incoming") {
      // I am Target. Picker is Source.
      return option?.sourceType || "person"; // TODO remove this fallback
    }
    // I am Source. Picker is Target.
    return option?.targetType || "person";
  });

  watch(edgeType, () => {
    if (!isEditingEdge.value) {
      // TODO should we lear pickers if type changes?
      if (myType.value !== "article") {
        pickerTarget.value = undefined;
      }
    }
  });

  function resetEdgeForm() {
    newEdge.value = emptyEdge();
    edgeType.value = "connection"; // TODO pick something else
    pickerTarget.value = undefined;
    pickerSource.value = undefined;
  }

  function openEditEdge(edge: EdgeNode) {
    // Determine direction relative to current node
    const direction = edge.source === nodeId.value ? "outgoing" : "incoming";

    newEdge.value = {
      ...edge,
      direction,
    };
    edgeType.value = edge.type;

    if (edge.type === "owns" && direction === "incoming") {
      // Check if the owner is a region
      // If we are editing, current node is target. Source is the owner.
      // edge.richNode is the OTHER node (source).
      if (edge.richNode?.type === "region") {
        edgeType.value = "owns_region" as EdgeType;
      }
    }

    pickerTarget.value = {
      ...edge.richNode,
      id: edge.richNode.id || "",
    };
  }

  function cancelEditEdge() {
    resetEdgeForm();
  }

  async function processEdge() {
    if (isEditingEdge.value) {
      // Edit mode (Revision)
      if (!newEdge.value.id || !newEdge.value.source) return;

      const payload = {
        node_id: newEdge.value.id,
        collection: "edges",
        source: newEdge.value.source, // Keep required context
        target: newEdge.value.target,
        type: getRealType(newEdge.value.type),
        name: newEdge.value.name,
        // text: newEdge.value.content, // Deprecated
        content: newEdge.value.content,
        start_date: newEdge.value.start_date,
        end_date: newEdge.value.end_date,
        references: newEdge.value.references,
      };

      await save({
        isNew: false,
        createEndpoint: "", // Not used
        revisionEndpoint: "/api/revisions/create",
        payload,
        onSuccess: async () => {
          resetEdgeForm();
          if (onUpdate) await onUpdate();
        },
      });
    } else {
      // Create mode
      if (!nodeId.value || !pickerTarget.value) return;

      const direction = newEdge.value.direction || "outgoing";
      // If we have pickerSource, use it. Otherwise use nodeId.
      const source = pickerSource.value
        ? pickerSource.value.id
        : direction === "outgoing"
          ? nodeId.value
          : pickerTarget.value.id;
      const target = pickerSource.value
        ? pickerTarget.value.id
        : direction === "outgoing"
          ? pickerTarget.value.id
          : nodeId.value;

      const payload = {
        source,
        target,
        type: getRealType(newEdge.value.type),
        name: newEdge.value.name,
        content: newEdge.value.content,
        start_date: newEdge.value.start_date,
        end_date: newEdge.value.end_date,
        references: newEdge.value.references,
      };

      // TODO it should be saveEdge and it should be strongly typed
      await save({
        isNew: true,
        createEndpoint: "/api/edges/create",
        revisionEndpoint: "", // Not used
        payload,
        onSuccess: async () => {
          resetEdgeForm();
          alert("Dodano powiązanie");
          if (onUpdate) await onUpdate();
        },
      });
    }
  }

  return {
    newEdge,
    edgeType,
    pickerTarget,
    pickerSource,
    isEditingEdge,
    availableEdgeTypes,
    edgeTargetType,
    edgeSourceType,
    edgeTypeOptions,
    processEdge,
    cancelEditEdge,
    openEditEdge,
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
