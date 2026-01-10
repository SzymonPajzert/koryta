type PageBase<PageType> = {
  id?: string;
  type: PageType;
  content?: string;
  revision_id?: string;
  votes?: Votes;
  deleted?: boolean;
  delete_reason?: string;
};

export type VoteCategory = "interesting" | "quality";

export type Votes = Record<
  VoteCategory,
  {
    total: number;
    [userUid: string]: number;
  }
>;

export type Node = PageBase<NodeType> & {
  name: string;
};

/**
 * PageRevisioned adds revisions array to the base page types
 * and makes sure the id is present.
 *
 * This is used for pages that have revisions pending review
 * and were enriched during the lookup.
 */
export type PageRevisioned = { id: string; revisions: Revision[] };

export interface Edge extends PageBase<EdgeType> {
  name?: string;
  source: string;
  target: string;
  start_date?: string;
  end_date?: string;
  references?: string[];
}

export function pageIsPublic(node: { revision_id?: string }) {
  return !!node.revision_id;
}

export type NodeType = "person" | "place" | "article" | "record";

export type EdgeType =
  | "employed"
  | "connection"
  | "mentions"
  | "owns"
  | "comment";

export const nodeTypeIcon: Record<NodeType, string> = {
  person: "mdi-account-outline",
  place: "mdi-office-building-outline",
  article: "mdi-file-document-outline",
  record: "mdi-file-document-outline",
};

export const destinationAddText: Record<NodeType, string> = {
  person: "Dodaj osobę",
  place: "Dodaj firmę",
  article: "Dodaj artykuł",
  record: "Dodaj rekord",
};

export interface Person {
  name: string;
  type: "person";
  parties?: string[];
  content?: string;
  wikipedia?: string;
  rejestrIo?: string;
  votes?: Votes;
}

export interface Company {
  name: string;
  type: "place";
  krsNumber?: string;
  votes?: Votes;
}

export interface Article {
  name: string;
  type: "article";
  sourceURL: string;
  shortName?: string;
  votes?: Votes;
}

export interface NodeTypeMap {
  person: Person;
  place: Company;
  article: Article;
  record: never;
}

export interface Revision {
  id: string;
  nodeId: string;
  data: Omit<Node, "revision_id"> | Omit<Edge, "revision_id">;
  update_time: string; // ISO string
  update_user: string;
}

export interface Link<T extends NodeType> {
  type: T;
  id: string;
  name: string;
}

export type Destination = NodeType;

export interface Connection<T extends Destination> {
  relation?: string;
  connection?: Link<T>;
  content?: string;
}

export interface Comment {
  id: string;
  content: string;
  authorId: string;
  authorName?: string; // Currently not strictly enforced, might rely on user fetching
  createdAt: string; // ISO string

  isLead: boolean; // True if no nodeId, edgeId, parentId
  nodeId?: string; // Optional: attached to a node (Person, Company, Article)
  edgeId?: string; // Optional: attached to an edge
  parentId?: string; // Optional: reply to another comment
}
