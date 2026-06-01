type PageBase<PageType> = {
  id?: string;
  type: PageType;
  content?: string;
  revision_id?: string | { path: string };
  votes?: Votes;
  deleted?: boolean;
  delete_reason?: string;
  visibility?: boolean;
  stats?: NodeStats;
};

type NodeEdgeStats = {
  experienceMonths: number;
  latestEmploymentStart?: string | null;
  targetNodeIds: string[];
};

export interface NodeStats {
  isApproved: boolean;
  notesCount: number;
  votes: {
    interesting?: number;
    quality?: number;
    humanVoted?: boolean;
    lastVotedAt?: string;
    [key: string]: unknown;
  };
  edges: {
    all: NodeEdgeStats;
    approved: NodeEdgeStats;
  };
  nodeGroupSize?: number;
  people?: number;
}

export type VoteCategory = "interesting" | "quality";

export type Votes = Record<
  VoteCategory,
  {
    total: number;
    [userUid: string]: number;
  }
>;

export type VoteDocument = {
  nodeId: string;
  userUid: string;
  categoryVotes: Record<string, number>;
  updatedAt?: string;
};

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

export type NodeType = "person" | "place" | "article" | "region";

export const nodeTypes: readonly NodeType[] = [
  "person",
  "place",
  "region",
  "article",
] as const;

export function nodeIcon(type: NodeType) {
  switch (type) {
    case "person":
      return "mdi-account-outline";
    case "place":
      return "mdi-office-building-outline";
    case "article":
      return "mdi-file-document-outline";
    default:
      return "mdi-comment-arrow-right-outline";
  }
}

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
  region: "mdi-map-marker-radius-outline",
};

export const destinationAddText: Record<NodeType, string> = {
  person: "Dodaj osobę",
  place: "Dodaj firmę",
  article: "Dodaj artykuł",
  region: "Dodaj region",
};

export interface Person extends Omit<Node, "type"> {
  type: "person";
  parties?: string[];
  birthDate?: string;
  wikipedia?: string;
  rejestrIo?: string;
}

export interface ElectionRich {
  year?: string;
  location?: string;
  teryt?: string;
  position: string;
  committee?: string;
}

export type PersonRich = Person & {
  id: string;
  companies: (string | undefined)[];
  elections: ElectionRich[];
  experience: number;
  latestEmploymentStart?: string | null;
};

export interface Company extends Omit<Node, "type"> {
  type: "place";
  krsNumber?: string;
}

export interface Article extends Omit<Node, "type"> {
  type: "article";
  sourceURL: string;
  shortName?: string;
}

export interface Region extends Omit<Node, "type"> {
  type: "region";
  teryt: string;
}

export interface NodeTypeMap {
  person: Person;
  place: Company;
  article: Article;
  record: never;
  region: Region;
}

export interface Revision {
  id?: string;
  nodeId?: string;
  node_id?: string;
  data: Node | Edge | Record<string, unknown>;
  revision_id?: string | { path: string } | unknown;
  update_time: string | unknown; // ISO string
  update_user: string;
  update_automatic?: boolean;
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

export type NoteSource = {
  url: string;
  note: string;
  // TODO enable users associating with a source node.
  // source_id: string;
};

/** Note allows users to collaborate on a node content without accessing the node itself.
 * A node can have multiple notes but one per user.
 * User can view/edit their own note and admins can view all notes.
 */
export type Note = {
  userUid: string;
  nodeId: string;

  // Users can easily add sources they encounter and annotate what they found interesting in them.
  sources?: NoteSource[];
};
