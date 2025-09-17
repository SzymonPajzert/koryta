export type Node = {
  name: string;
  type: NodeType;
  text?: string;
};

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

export interface Edge {
  source: string;
  target: string;
  name?: string;
  text?: string;
  type: EdgeType;
}

export interface Person {
  name: string;
  parties?: string[];
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
