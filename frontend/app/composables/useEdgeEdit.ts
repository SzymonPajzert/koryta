import { computed } from "vue";
import type { NodeType, Edge, Link } from "~~/shared/model";
import { edgeTypeOptions, type edgeTypeExt } from "./useEdgeTypes";
import { useEntityMutation } from "./useEntityMutation";

export type NodeRef = {
  id?: string;
  type: NodeType;
  ref: Ref<Link<NodeType> | undefined>;
};

interface UseEdgeEditOptions {
  fixedNode?: NodeRef; // The node we are "on" (context)
  referenceNode?: NodeRef; // Optional node reference for article mode
  edgeType: edgeTypeExt;
  editedEdge?: string;
  onUpdate: () => Promise<void>;
}

export function useEdgeEdit({
  fixedNode,
  referenceNode,
  edgeType,
  editedEdge,
  onUpdate,
}: UseEdgeEditOptions) {
  const { save } = useEntityMutation();

  const newEdge = ref<Partial<Edge>>(emptyEdge());
  const currentOption = edgeTypeOptions[edgeType];

  const _v = referenceNode;

  const matches = (position: "source" | "target") => {
    if (referenceNode) return false; // we want both to be pickable
    const expectedType =
      position === "source"
        ? currentOption.sourceType
        : currentOption.targetType;
    return fixedNode?.type === expectedType;
  };

  const layout: { source: NodeRef; target: NodeRef } = {
    source: {
      id: matches("source") ? fixedNode?.id : undefined,
      type: currentOption.sourceType,
      ref: ref<Link<NodeType> | undefined>(undefined),
    },
    target: {
      id: matches("target") ? fixedNode?.id : undefined,
      type: currentOption.targetType,
      ref: ref<Link<NodeType> | undefined>(undefined),
    },
  };

  const sourceId = computed(() => {
    return layout.source.ref.value?.id ?? layout.source.id;
  });
  const targetId = computed(() => {
    return layout.target.ref.value?.id ?? layout.target.id;
  });

  const readyToSubmit = computed(() => {
    // Must have picked nodes or they are already picked
    return !!sourceId.value && !!targetId.value;
  });

  const edgeLabel = edgeTypeOptions[edgeType].label;

  async function processEdge() {
    if (!readyToSubmit.value) {
      alert("Brak źródła lub celu!");
      return;
    }

    const payload = {
      source: sourceId.value,
      target: targetId.value,
      type: currentOption.realType,
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
      successMessage: "Dodano powiązanie!",
      onSuccess: async () => {
        await onUpdate();
      },
    });
  }

  return {
    newEdge,
    edgeType,
    edgeLabel,
    layout,
    readyToSubmit,
    // Methods
    processEdge,
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
