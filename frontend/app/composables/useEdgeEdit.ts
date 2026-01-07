import { computed, watch, ref, toValue, type Ref } from "vue";
import type { NodeType, EdgeType, Edge, Link } from "~~/shared/model";

interface UseEdgeEditOptions {
  nodeId: Ref<string | undefined>;
  nodeType: Ref<NodeType>;
  authHeaders: Ref<Record<string, string>>;
  onUpdate?: () => Promise<void>;
  stateKey?: Ref<string>; // Optional stateKey for shared state
}

type edgeTypeOption = {
  value: string;
  label: string;
  sourceType: NodeType;
  targetType: NodeType;
  realType: EdgeType;
};

const edgeTypeOptions: edgeTypeOption[] = [
  {
    value: "owns",
    label: "Właściciel",
    sourceType: "place",
    targetType: "place",
    realType: "owns",
  },
  {
    value: "connection",
    label: "Powiązanie z",
    sourceType: "person",
    targetType: "person",
    realType: "connection",
  },
  {
    value: "mentioned_person",
    label: "Wspomina osobę",
    sourceType: "article",
    targetType: "person",
    realType: "mentions",
  },
  {
    value: "mentioned_company",
    label: "Wspomina firmę/urząd",
    sourceType: "article",
    targetType: "place",
    realType: "mentions",
  },
  {
    value: "employed",
    label: "Zatrudniony/a w",
    sourceType: "person",
    targetType: "place",
    realType: "employed",
  },
];

export function useEdgeEdit({
  nodeId,
  nodeType: myType,
  authHeaders,
  onUpdate,
  stateKey = ref("global-edge-edit"),
}: UseEdgeEditOptions) {
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
      const option = edgeTypeOptions.find((o) => o.value === t);
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
      if (!isEditingEdge.value) {
        pickerTarget.value = undefined;

        // Re-validate current edgeType
        const option = edgeTypeOptions.find((o) => o.value === edgeType.value);
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

  const edgeTargetType = computed<NodeType>(() => {
    const option = edgeTypeOptions.find((o) => o.value === edgeType.value);
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
      pickerTarget.value = undefined;
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
      await saveEdgeRevision();
    } else {
      await addEdge();
    }
  }

  async function addEdge() {
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

    try {
      await $fetch<undefined>("/api/edges/create", {
        method: "POST",
        headers: authHeaders.value,
        body: {
          source,
          target,
          type: newEdge.value.type,
          name: newEdge.value.name,
          content: newEdge.value.content,
          start_date: newEdge.value.start_date,
          end_date: newEdge.value.end_date,
          references: newEdge.value.references,
        },
      });
      resetEdgeForm();
      alert("Dodano powiązanie");
      if (onUpdate) await onUpdate();
    } catch (e) {
      alertError(e);
    }
  }

  async function saveEdgeRevision() {
    if (!newEdge.value.id || !newEdge.value.source) return;

    try {
      await $fetch<{ id: string }>("/api/revisions/create", {
        method: "POST",
        body: {
          node_id: newEdge.value.id,
          collection: "edges",
          source: newEdge.value.source, // Keep required context
          target: newEdge.value.target,
          type: newEdge.value.type,
          name: newEdge.value.name,
          // text: newEdge.value.content, // Deprecated
          content: newEdge.value.content,
          start_date: newEdge.value.start_date,
          end_date: newEdge.value.end_date,
          references: newEdge.value.references,
        },
        headers: authHeaders.value,
      });
      alert("Zapisano propozycję zmiany!");
      resetEdgeForm();
      if (onUpdate) await onUpdate();
    } catch (e) {
      alertError(e);
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
    edgeTypeOptions,
    processEdge,
    cancelEditEdge,
    openEditEdge,
  };
}

function alertError(e: unknown) {
  console.error(e);
  if (!(e instanceof Error)) return;
  const msg = e.message || "Unknown error";
  alert("Błąd dodawania powiązania: " + msg);
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
