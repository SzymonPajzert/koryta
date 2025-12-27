export interface Node {
  name: string;
  prettyURL?: string;

  type: "circle" | "rect" | "document";
  color: string;
  sizeMult?: number;
  hide?: boolean;
}

export interface NodeStats {
  people: number;
}

export interface NodeGroup {
  id: string;
  name: string;
  connected: string[];
  stats: NodeStats;
}

type TraverseState = "active" | "dead_end";
export const SPLIT = "*split*" as const;

export interface TraversePolicy {
  // When filterting by place, should this relation be included?
  // What to do if you connect from this -> node
  forward?: TraverseState;
  // What to do if you connect from node -> this
  backward?: TraverseState;
}

export interface Edge {
  id?: string;
  source: string;
  target: string;
  label: string;
  type: "employed" | "connection" | "mentions" | "owns" | "comment";

  traverse?: TraversePolicy;
}
