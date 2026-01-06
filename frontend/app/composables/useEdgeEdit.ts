import { computed, watch, ref, toValue, type Ref } from "vue";
import type { NodeType, Edge } from "~~/shared/model";

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
  realType: string;
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

  const newEdge = useState<Partial<Edge>>(`${baseKey}-newEdge`, () => ({
    type: "connection",
    target: "",
    name: "",
    content: "",
    start_date: "",
    end_date: "",
    // @ts-ignore
    direction: "outgoing",
  }));

  // Isolated ref for v-select
  const edgeType = useState<string>(`${baseKey}-edgeType`, () => "connection");

  // Sync edgeType -> newEdge.type
  watch(edgeType, (t) => {
    newEdge.value.type = t as any;
  });

  const pickerTarget = useState<any>(`${baseKey}-pickerTarget`, () => null); // eslint-disable-line @typescript-eslint/no-explicit-any

  const isEditingEdge = computed(() => !!newEdge.value.id);

  const availableEdgeTypes = computed(() => {
    const dir = (newEdge.value as any).direction || "outgoing";
    return edgeTypeOptions.filter((o) => {
      if (dir === "outgoing") {
        const rs = o.sourceType;
        return (
          !rs ||
          (Array.isArray(rs)
            ? rs.includes(myType.value as any)
            : rs === myType.value)
        );
      } else {
        const rt = o.targetType;
        return (
          !rt ||
          (Array.isArray(rt)
            ? rt.includes(myType.value as any)
            : rt === myType.value)
        );
      }
    });
  });

  // Handle type selection -> enforce direction if needed
  watch(edgeType, (t) => {
    if (!isEditingEdge.value) {
      const option = edgeTypeOptions.find((o) => o.value === t);
      if (option) {
        const reqSource = option.sourceType;
        const reqTarget = option.targetType;

        const canBeSource =
          !reqSource ||
          (Array.isArray(reqSource)
            ? reqSource.includes(myType.value as any)
            : reqSource === myType.value);
        const canBeTarget =
          !reqTarget ||
          (Array.isArray(reqTarget)
            ? reqTarget.includes(myType.value as any)
            : reqTarget === myType.value);

        // If strictly directional relative to me
        if (canBeSource && !canBeTarget) {
          (newEdge.value as any).direction = "outgoing";
        } else if (!canBeSource && canBeTarget) {
          (newEdge.value as any).direction = "incoming";
        }
      }
    }
  });

  // Handle direction switch -> validate type
  watch(
    () => (newEdge.value as any).direction,
    (newDir) => {
      if (!isEditingEdge.value) {
        pickerTarget.value = null;

        // Re-validate current edgeType
        const option = edgeTypeOptions.find((o) => o.value === edgeType.value);
        let currentStillValid = false;
        if (option) {
          const rs = option.sourceType;
          const rt = option.targetType;
          if (newDir === "outgoing") {
            currentStillValid =
              !rs ||
              (Array.isArray(rs)
                ? rs.includes(myType.value as any)
                : rs === myType.value);
          } else {
            currentStillValid =
              !rt ||
              (Array.isArray(rt)
                ? rt.includes(myType.value as any)
                : rt === myType.value);
          }
        }

        if (!currentStillValid) {
          // Default to the first available type for the new direction
          if (availableEdgeTypes.value.length > 0) {
            edgeType.value = availableEdgeTypes.value[0].value;
          }
        }
      }
    },
    { deep: true },
  );

  const edgeTargetType = computed<NodeType>(() => {
    const option = edgeTypeOptions.find((o) => o.value === edgeType.value);
    // @ts-ignore
    const dir = newEdge.value.direction;
    if (dir === "incoming") {
      // I am Target. Picker is Source.
      const st = option?.sourceType;
      return (Array.isArray(st) ? st[0] : (st as NodeType)) || "person";
    }
    // I am Source. Picker is Target.
    const tt = option?.targetType;
    return (Array.isArray(tt) ? tt[0] : (tt as NodeType)) || "person";
  });

  watch(edgeType, () => {
    if (!isEditingEdge.value) {
      pickerTarget.value = null;
    }
  });

  function resetEdgeForm() {
    newEdge.value = {
      type: "connection",
      target: "",
      name: "",
      content: "",
      start_date: "",
      end_date: "",
      // @ts-ignore
      direction: "outgoing",
    };
    edgeType.value = "connection";
    pickerTarget.value = null;
  }

  function openEditEdge(edge: any) {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    let type = edge.type;
    const targetType = edge.richNode?.type || "person";
    if (type === "mentions") {
      type = targetType === "place" ? "mentions_place" : "mentions_person";
    }

    // Determine direction relative to current node
    const direction = edge.source === nodeId.value ? "outgoing" : "incoming";

    newEdge.value = {
      ...edge,
      type,
      direction,
    };
    edgeType.value = type;
    pickerTarget.value = edge.richNode;
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

  function getRealType(uiType: string | undefined): string {
    const option = edgeTypeOptions.find((o) => o.value === uiType);
    return (option as any)?.realType || uiType;
  }

  async function addEdge() {
    if (!nodeId.value || !pickerTarget.value) return;

    // @ts-ignore
    const direction = newEdge.value.direction || "outgoing";
    const source =
      direction === "outgoing" ? nodeId.value : pickerTarget.value.id;
    const target =
      direction === "outgoing" ? pickerTarget.value.id : nodeId.value;

    try {
      await $fetch<any>("/api/edges/create", {
        method: "POST",
        headers: authHeaders.value,
        body: {
          source,
          target,
          type: getRealType(newEdge.value.type),
          name: newEdge.value.name,
          content: newEdge.value.content,
          start_date: newEdge.value.start_date,
          end_date: newEdge.value.end_date,
        },
      });
      resetEdgeForm();
      alert("Dodano powiązanie");
      if (onUpdate) await onUpdate();
    } catch (e: any) {
      console.error(e);
      const msg = e.data?.statusMessage || e.message || "Unknown error";
      alert("Błąd dodawania powiązania: " + msg);
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
          type: getRealType(newEdge.value.type),
          name: newEdge.value.name,
          // text: newEdge.value.content, // Deprecated
          content: newEdge.value.content,
          start_date: newEdge.value.start_date,
          end_date: newEdge.value.end_date,
        },
        headers: authHeaders.value,
      });
      alert("Zapisano propozycję zmiany!");
      resetEdgeForm();
      if (onUpdate) await onUpdate();
    } catch (e: any) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      console.error(e);
      const msg = e.data?.statusMessage || e.message || "Unknown error";
      alert("Błąd zapisu: " + msg);
    }
  }

  return {
    newEdge,
    edgeType,
    pickerTarget,
    isEditingEdge,
    availableEdgeTypes,
    edgeTargetType,
    edgeTypeOptions,
    processEdge,
    cancelEditEdge,
    openEditEdge,
  };
}
