/* eslint-disable @typescript-eslint/no-unused-vars */
// TODO remove this disable

import type { Ref } from "vue";
import type { NodeType, Edge, Link } from "~~/shared/model";
import type { edgeTypeExt } from "./useEdgeTypes";

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
  throw new Error("Not implemented");

  const newEdge = {
    id: "",
    name: "",
    content: "",
    start_date: "",
    end_date: "",
    party: "",
    committee: "",
    position: undefined,
    elected: false,
    term: "",
    by_election: false,
  };
  const layout = {
    target: {
      ref: ref<Link<NodeType> | undefined>(undefined),
      type: ref<NodeType>("person"),
      id: ref(fixedNode?.id),
    },
    source: {
      ref: ref<Link<NodeType> | undefined>(undefined),
      type: ref<NodeType>("person"),
      id: ref(fixedNode?.type),
    },
  };
  const readyToSubmit = null;
  const availableEdgeTypes = null;
  const pickedNode = null;
  // Methods
  const processEdge = () => {};
  const openEditEdge = null;
  const edgeLabel = "";
  const edgeTypeRef = ref(edgeType);

  return {
    newEdge,
    edgeType: edgeTypeRef,
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
