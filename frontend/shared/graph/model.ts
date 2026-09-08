import type { ElectionPosition } from "../model";

export interface Node {
  name: string;
  prettyURL?: string;
  /** The node's own id, the same string the layout files it under.
   *
   * Carried off the database record by `parseNodeDoc` and spread through by
   * `shared/graph/nodes.ts`, so it is there on every node the canvas ever
   * sees - and the canvas needs it, because v-network-graph hands a config
   * callback the node object and nothing else. Optional because the graph
   * models are also built by hand in tests. */
  id?: string;

  type: "circle" | "rect" | "document";
  color: string;
  sizeMult?: number;
  hide?: boolean;
  parties?: string[];
  visibility?: boolean;
  entityType?: string;
  /** Only on company nodes, see `Company.isPublic`. */
  isPublic?: boolean;
  /** How many relations away from the page's subject this node sits: 0 for the
   * subject itself, 1 for something it is directly related to, 2 for a relation
   * of one of those.
   *
   * Set by `getGraphBFS`, so it is absent on a layout that has no subject to
   * count from - an article's, a topic's. The canvas draws the outer ring
   * smaller and paler than the inner one, which is what keeps a two hop graph
   * readable: without it a colleague's other employer looks exactly as much
   * this person's business as their own. */
  depth?: number;
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
    | "seat"
    | "comment"
    | "election"
    | "tagged";

  traverse?: TraversePolicy;
  content?: string;
  name?: string;
  /** The relation's name read the other way round - see `Edge.reverse_name`.
   * Carried through so the pages that draw a node's relations off the local
   * graph can label each row from the end they are standing on. */
  reverse_name?: string;
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
