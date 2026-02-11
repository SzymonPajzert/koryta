import { computed, ref, unref, type Ref } from "vue";
import type { NodeType, Edge, Link } from "~~/shared/model";
import { edgeTypeOptions, type edgeTypeExt } from "./useEdgeTypes";
import { useEntityMutation } from "./useEntityMutation";

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

export function useEdgeEdit({
  fixedNode,
  referenceNode: _referenceNode,
  edgeType = "connection",
  initialDirection,
  editedEdge,
  onUpdate = async () => {},
}: Partial<UseEdgeEditOptions>) {
  const { save } = useEntityMutation();

  const newEdge = ref<InternalEdge>(
    initialDirection
      ? { ...emptyEdge(), direction: initialDirection }
      : emptyEdge(),
  );
  const internalEdgeType = ref(edgeType);
  const currentOption = computed(() =>
    internalEdgeType.value
      ? edgeTypeOptions[internalEdgeType.value]
      : undefined,
  );

  const matches = (position: "source" | "target") => {
    if (!currentOption.value) return false;
    const direction = newEdge.value.direction;
    const expectedPosition = direction === "outgoing" ? "source" : "target";
    if (position !== expectedPosition) return false;

    const expectedType =
      position === "source"
        ? currentOption.value.sourceType
        : currentOption.value.targetType;
    return unref(fixedNode)?.type === expectedType;
  };

  const layout = {
    source: {
      id: computed(() =>
        matches("source") ? unref(fixedNode)?.id : undefined,
      ),
      type: computed(() => currentOption.value?.sourceType || "person"),
      ref: ref<Link<NodeType> | undefined>(undefined),
    },
    target: {
      id: computed(() =>
        matches("target") ? unref(fixedNode)?.id : undefined,
      ),
      type: computed(() => currentOption.value?.targetType || "person"),
      ref: ref<Link<NodeType> | undefined>(undefined),
    },
  };

  const pickedNode = computed({
    get: () => {
      if (matches("source")) return layout.target.ref.value;
      if (matches("target")) return layout.source.ref.value;
      return undefined;
    },
    set: (val) => {
      if (matches("source")) layout.target.ref.value = val as any;
      else if (matches("target")) layout.source.ref.value = val as any;
    },
  });

  const sourceId = computed(() => {
    return layout.source.ref.value?.id ?? layout.source.id.value;
  });
  const targetId = computed(() => {
    return layout.target.ref.value?.id ?? layout.target.id.value;
  });

  const readyToSubmit = computed(() => {
    return !!sourceId.value && !!targetId.value;
  });

  const edgeLabel = computed(() => currentOption.value?.label || "");

  async function processEdge() {
    if (!readyToSubmit.value) {
      return;
    }

    const payload = {
      source: sourceId.value,
      target: targetId.value,
      type: currentOption.value?.realType,
      name: newEdge.value.name,
      content: newEdge.value.content,
      start_date: newEdge.value.start_date,
      end_date: newEdge.value.end_date,
      references: newEdge.value.references,
    };

    const payloadFull = editedEdge
      ? {
          ...payload,
          id: editedEdge,
        }
      : payload;

    await save({
      isNew: editedEdge ? false : true,
      createEndpoint: editedEdge ? "" : "/api/edges/create",
      revisionEndpoint: editedEdge ? "/api/revisions/create" : "",
      payload: payloadFull,
      successMessage: editedEdge
        ? "Zapisano propozycję zmiany!"
        : "Dodano powiązanie!",
      onSuccess: async () => {
        await onUpdate();
      },
    });
  }

  const availableEdgeTypes = computed(() => {
    const fn = unref(fixedNode);
    if (!fn) return [];
    return Object.values(edgeTypeOptions).filter((option) => {
      const direction = newEdge.value.direction || "outgoing";
      if (
        option.allowedDirections &&
        !option.allowedDirections.includes(direction)
      ) {
        return false;
      }
      if (direction === "outgoing") {
        return option.sourceType === fn.type;
      } else {
        return option.targetType === fn.type;
      }
    });
  });

  function openEditEdge(edge: Edge) {
    const internalEdge = edge as InternalEdge;
    newEdge.value = { ...internalEdge };
    const fn = unref(fixedNode);
    // Try to detect edgeTypeExt
    if (edge.type === "owns") {
      // Determine if it's owns_parent, owns_child or owns_region
      if (internalEdge.richNode?.type === "region") {
        internalEdgeType.value = "owns_region";
      } else if (edge.source === fn?.id) {
        internalEdgeType.value = "owns_child";
      } else {
        internalEdgeType.value = "owns_parent";
      }
    } else {
      internalEdgeType.value = edge.type as edgeTypeExt;
    }

    if (matches("source")) {
      layout.target.ref.value = {
        id: edge.target,
        type: layout.target.type.value,
      } as any;
    } else if (matches("target")) {
      layout.source.ref.value = {
        id: edge.source,
        type: layout.source.type.value,
      } as any;
    }
  }

  return {
    newEdge,
    edgeType: internalEdgeType,
    edgeLabel,
    layout,
    readyToSubmit,
    availableEdgeTypes,
    pickedNode,
    // Methods
    processEdge,
    openEditEdge,
  };
}

function emptyEdge(): InternalEdge {
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
