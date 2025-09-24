export interface Textable {
  text: string;
}
export interface Nameable {
  name: string;
}
export interface Connection<D extends Destination> {
  text: string;
  connection?: Link<D>;
  relation: string;
}

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

// TODO Get rid of destination
// Top level types represented by their own path in the DB.
export type Destination = "employed" | "company" | "data";

export const destinationToNodeType: Record<Destination, NodeType> = {
  employed: "person",
  company: "place",
  data: "article",
};

export const destinationIcon: Record<Destination, string> = {
  employed: "mdi-account-outline",
  company: "mdi-office-building-outline",
  data: "mdi-file-document-outline",
};

export const destinationAddText: Record<Destination, string> = {
  employed: "Dodaj osobę",
  company: "Dodaj firmę",
  data: "Dodaj artykuł",
};

export interface Edge {
  source: string;
  target: string;
  name?: string;
  text?: string;
  type: EdgeType;
}

export interface Person extends Nameable {
  name: string;
  parties?: string[];
}

export interface Company extends Nameable {
  name: string;
  krsNumber?: string;
  nipNumber?: string;
}

export interface Article extends Nameable {
  sourceURL: string;
  shortName?: string;
  estimates: {
    mentionedPeople?: number;
  };
}

interface RejestrCompany {
  id: string;
  nazwy: {
    skrocona: string;
  };
}

export interface KRSCompany extends Nameable {
  external_basic?: RejestrCompany;
  basic?: RejestrCompany;
  connections?: Record<
    string,
    { state: "aktualne" | "historyczne"; type: "person" | "org" }
  >;
}

export interface PersonRejestr extends Nameable {
  external_basic: {
    id: string;
    state: "aktualne" | "historyczne";
    tozsamosc: {
      data_urodzenia: string;
    };
  };

  comment?: Record<string, string>;
  link?: Record<string, string>;
  status?: "unknown";
  score?: number;
  person?: Link<"employed">;
}

export interface DestinationTypeMap {
  employed: Person;
  company: Company;
  data: Article;
  "external/rejestr-io/krs": KRSCompany;
  "external/rejestr-io/person": PersonRejestr;
}

export class Link<T extends Destination> {
  public readonly type: T;
  public readonly id: string;
  public readonly text: string;
  constructor(type: T, id: string, text: string) {
    this.type = type;
    this.id = id;
    this.text = text;
  }
}
