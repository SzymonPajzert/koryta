import { computed, ref, watch, type Ref } from "vue";
import type { NodeType, Edge } from "~~/shared/model";

interface UseEdgeEditOptions {
  nodeId: Ref<string | undefined>;
  nodeType: Ref<NodeType>;
  authHeaders: Ref<Record<string, string>>;
  onUpdate?: () => Promise<void>;
}

export function useEdgeEdit({
  nodeId,
  nodeType: myType,
  authHeaders,
  onUpdate,
}: UseEdgeEditOptions) {
  /* eslint-disable @typescript-eslint/naming_convention */
  const edgeTypeOptions = [
    {
      value: "owns",
      label: "Właściciel",
      sourceType: "person",
      targetType: "place",
    },
    {
      value: "connection",
      label: "Powiązanie z",
      sourceType: "person",
      targetType: "person",
    },
    {
      value: "mentions_person",
      label: "Wspomina osobę",
      // sourceType: "person", // Generic source
      targetType: "person",
      realType: "mentions",
    },
    {
      value: "employed",
      label: "Zatrudniony/a w",
      sourceType: "person",
      targetType: "place",
    },
    {
      value: "mentions_place",
      label: "Wspomina firmę/urząd",
      // sourceType: "person", // Generic source
      targetType: "place",
      realType: "mentions",
    },
  ];
  /* eslint-enable @typescript-eslint/naming_convention */

  const newEdge = ref<Partial<Edge>>({
    type: "connection",
    target: "",
    name: "",
    content: "",
    start_date: "",
    end_date: "",
    // @ts-ignore
    direction: "outgoing",
  });

  // Isolated ref for v-select
  const edgeType = ref<string>("connection");

  // Sync edgeType -> newEdge.type
  watch(edgeType, (t) => {
    newEdge.value.type = t as any;
  });

  const pickerTarget = ref<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  const isEditingEdge = computed(() => !!newEdge.value.id);

  const availableEdgeTypes = computed(() => {
    return edgeTypeOptions.filter((o) => {
      // @ts-ignore
      const reqSource = o.sourceType;
      // @ts-ignore
      const reqTarget = o.targetType;

      const canBeSource = !reqSource || reqSource === myType.value;
      const canBeTarget = !reqTarget || reqTarget === myType.value;

      return canBeSource || canBeTarget;
    });
  });

  // Handle type selection -> enforce direction if needed
  watch(edgeType, (t) => {
    newEdge.value.type = t as any;

    if (!isEditingEdge.value) {
      const option = edgeTypeOptions.find((o) => o.value === t);
      if (option) {
        // @ts-ignore
        const reqSource = option.sourceType;
        // @ts-ignore
        const reqTarget = option.targetType;

        const canBeSource = !reqSource || reqSource === myType.value;
        const canBeTarget = !reqTarget || reqTarget === myType.value;

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

        // Validate if current edgeType is valid for new direction
        const option = edgeTypeOptions.find((o) => o.value === edgeType.value);
        if (option) {
          // @ts-ignore
          const reqSource = option.sourceType;
          // @ts-ignore
          const reqTarget = option.targetType;

          let isValid = false;
          if (newDir === "outgoing") {
            if (!reqSource || reqSource === myType.value) isValid = true;
          } else {
            if (!reqTarget || reqTarget === myType.value) isValid = true;
          }

          if (!isValid) {
            // Find a valid type for this direction
            const validOption = availableEdgeTypes.value.find((o) => {
              // @ts-ignore
              const rs = o.sourceType;
              // @ts-ignore
              const rt = o.targetType;
              if (newDir === "outgoing") return !rs || rs === myType.value;
              return !rt || rt === myType.value;
            });
            if (validOption) {
              edgeType.value = validOption.value;
            }
          }
        }
      }
    },
  );

  const edgeTargetType = computed<NodeType>(() => {
    const option = edgeTypeOptions.find((o) => o.value === edgeType.value);
    // @ts-ignore
    const dir = newEdge.value.direction;
    if (dir === "incoming") {
      // I am Target. Picker is Source.
      // @ts-ignore
      return (option?.sourceType as NodeType) || "person";
    }
    // I am Source. Picker is Target.
    // @ts-ignore
    return (option?.targetType as NodeType) || "person";
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
