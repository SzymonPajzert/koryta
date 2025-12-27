export type Node = {
  name: string;
  type: NodeType;
  text?: string;
  revision_id?: string;
};

export interface Edge {
  source: string;
  target: string;
  name?: string;
  text?: string;
  type: EdgeType;
  revision_id?: string;
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
  parties?: string[];
  content?: string;
}

export interface Company {
  name: string;
  krsNumber?: string;
  nipNumber?: string;
}

export interface Article {
  name: string;
  sourceURL: string;
  shortName?: string;
  estimates: {
    mentionedPeople?: number;
  };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  update_time: string; // ISO string
  update_user: string;
}
