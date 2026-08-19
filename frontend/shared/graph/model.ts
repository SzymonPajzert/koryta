import type { ElectionPosition } from "../model";

export interface Node {
  name: string;
  prettyURL?: string;

  type: "circle" | "rect" | "document";
  color: string;
  sizeMult?: number;
  hide?: boolean;
  parties?: string[];
  visibility?: boolean;
  entityType?: string;
  /** Only on company nodes, see `Company.isPublic`. */
  isPublic?: boolean;
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
  label?: string;
  type:
    | "employed"
    | "connection"
    | "mentions"
    | "owns"
    | "comment"
    | "election"
    | "tagged"
    // Not a relation anybody wrote down, and not a document in `edges`: it is
    // worked out from two `election` edges that name the same list. See
    // `shared/graph/coCandidates.ts`. It exists only in a `GraphLayout`, which
    // is why it is on this union and not on `EdgeType` in `shared/model.ts` -
    // nothing may ever try to store one.
    | "co_candidate";

  traverse?: TraversePolicy;
  content?: string;
  name?: string;
  references?: string[];
  visibility?: boolean;
  party?: string;
  committee?: string;
  position?: ElectionPosition;
  elected?: boolean;
  term?: string;
  by_election?: boolean;
  start_date?: string;
  end_date?: string;
}
