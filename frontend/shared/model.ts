type PageBase<PageType> = {
  id?: string;
  type: PageType;
  content?: string;
  revision_id?: string | { path: string };
  votes?: Votes;
  deleted?: boolean;
  delete_reason?: string;
  visibility?: boolean;
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

export interface Edge extends PageBase<EdgeType> {
  name?: string;
  source: string;
  label?: string; // a derivative of name, see graph/model.ts
  target: string;
  start_date?: string;
  end_date?: string;
  references?: string[];
  party?: string;
  committee?: string;
  position?: ElectionPosition;
  elected?: boolean;
  term?: string;
  by_election?: boolean;
}

export type ElectionPosition =
  | "Samorząd"
  | "Sejmik"
  | "Rada miasta"
  | "Rada gminy"
  | "Rada powiatu"
  | "Burmistrz"
  | "Wójt"
  | "Prezydent"
  | "Sejm"
  | "Senat"
  | "Parlament Europejski";

export function pageIsPublic(node: { revision_id?: unknown }) {
  return !!node.revision_id;
}

export type NodeType = "person" | "place" | "article" | "record" | "region";

export type EdgeType =
  | "employed"
  | "connection"
  | "mentions"
  | "owns"
  | "comment"
  | "election";

export const nodeTypeIcon: Record<NodeType, string> = {
  person: "mdi-account-outline",
  place: "mdi-office-building-outline",
  article: "mdi-file-document-outline",
  record: "mdi-file-document-outline",
  region: "mdi-map-marker-radius-outline",
};

export const destinationAddText: Record<NodeType, string> = {
  person: "Dodaj osobę",
  place: "Dodaj firmę",
  article: "Dodaj artykuł",
  record: "Dodaj rekord",
  region: "Dodaj region",
};

export type Person = {
  name: string;
  type: "person";
  parties?: string[];
  content?: string;
  birthDate?: string;
  wikipedia?: string;
  rejestrIo?: string;
  votes?: Votes;
  visibility?: boolean;
};

export interface ElectionRich {
  year?: string;
  location?: string;
  position: string;
  committee?: string;
}

export type PersonRich = Person & {
  id: string;
  companies: (string | undefined)[];
  elections: ElectionRich[];
  experience: number;
};

export interface Company {
  name: string;
  type: "place";
  krsNumber?: string;
  content?: string;
  votes?: Votes;
  visibility?: boolean;
}

export interface Article {
  name: string;
  type: "article";
  sourceURL: string;
  shortName?: string;
  content?: string;
  votes?: Votes;
  visibility?: boolean;
}

export interface Region {
  name: string;
  type: "region";
  teryt: string;
  content?: string;
  votes?: Votes;
  visibility?: boolean;
}

export interface NodeTypeMap {
  person: Person;
  place: Company;
  article: Article;
  record: never;
  region: Region;
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
