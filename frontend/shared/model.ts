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

// Top level types represented by their own path in the DB.
export type Destination =
  | "employed"
  | "company"
  | "data"
  | "todo"
  | "external/rejestr-io/krs"
  | "external/rejestr-io/person";

export const articleTags = [
  "ludzie wyciągnięci",
  "dodatkowe informacje",
  "nie łącz w grafie",
  "nie pokazuj w grafie",
  "przeczytane",
] as const;
type ArticleTag = (typeof articleTags)[number];

export const destinationIcon: Record<Destination, string> = {
  employed: "mdi-account-outline",
  company: "mdi-office-building-outline",
  data: "mdi-file-document-outline",
  todo: "mdi-help-circle-outline",
  "external/rejestr-io/krs": "mdi-office-building-outline",
  "external/rejestr-io/person": "mdi-account-outline",
};

export const destinationAddText: Record<Destination, string> = {
  employed: "Dodaj osobę",
  company: "Dodaj firmę",
  data: "Dodaj artykuł",
  todo: "Dodaj zadanie",
  "external/rejestr-io/krs": "",
  "external/rejestr-io/person": "",
};

export interface NepoEmployment extends Nameable {
  name: string;
  parties?: string[];

  employments: Record<string, Connection<"company">>;
  connections: Record<string, Connection<"employed">>;

  todos: Record<string, Link<"todo">>;
  comments: Record<string, Textable>;
}

export interface Company extends Nameable {
  name: string;
  owners: Record<string, Link<"company">>;
  krsNumber?: string;
  nipNumber?: string;

  owner?: Link<"company">;
  manager?: Link<"employed">;

  todos: Record<string, Link<"todo">>;
  comments: Record<string, Textable>;
}

export interface Article extends Nameable {
  sourceURL: string;
  people: Record<string, Link<"employed">>;
  companies: Record<string, Link<"company">>;

  shortName?: string;
  estimates: {
    mentionedPeople?: number;
  };

  date?: number;
  status: ArticleStatus;

  todos: Record<string, Link<"todo">>;
  comments: Record<string, Textable>;
}

export interface Todo extends Nameable {
  text: string;
  subtasks: Record<string, Link<"todo">>;
}

export type KPOSubmission = {
  id: string;
  content: string;
  title: string;
  admin: {
    title: string;
    approved?: boolean;
    connected: Record<string, Link<"employed">>;
  }
  score: number;
};

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

type uid = string;

interface ArticleStatus {
  tags: ArticleTag[];

  signedUp: Record<uid, number>;
  markedDone: Record<uid, number>;
  confirmedDone: boolean;
}

export interface DestinationTypeMap {
  employed: NepoEmployment;
  company: Company;
  data: Article;
  todo: Todo;
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
