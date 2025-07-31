import { ref as dbRef, push } from "firebase/database";
import { db } from "@/firebase";

export interface Textable {
  text: string;
}
export interface Nameable {
  name: string;
  // TODO support stability
  // If set, the name will be used as the url
  // isStable?: boolean;
  // If isStable and stablePath is set, use the path instead of the name
  // stablePath?: string[];
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

  // TODO(https://github.com/SzymonPajzert/koryta/issues/44): Migrate away from them
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

interface RejestrCompany {
  id: string;
  nazwy: {
    skrocona: string;
  };
}

// TODO move these to proper fields, instead of the ingested external basic and basic
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

export function newKey() {
  const newKey = push(dbRef(db, "_temp_keys/employments")).key;
  if (!newKey) {
    throw "Failed to create a key";
  }
  return newKey;
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

function recordOf<T>(value: T): Record<string, T> {
  const result: Record<string, T> = {};
  result[newKey()] = value;
  return result;
}

export function fillBlanks<D extends Destination>(
  value: Partial<DestinationTypeMap[D]>,
  d: D,
): Required<DestinationTypeMap[D]>;
export function fillBlanks<D extends Destination>(
  valueUntyped: Partial<DestinationTypeMap[D]>,
  d: D,
) {
  if (d == "company") {
    const value = valueUntyped as Partial<Company>;
    const result: Required<DestinationTypeMap["company"]> = {
      name: value.name ?? "",
      krsNumber: value.krsNumber ?? "",
      nipNumber: value.nipNumber ?? "",

      owners: value.owners ?? recordOf(new Link("company", "", "")),
      todos: value.todos ?? recordOf(new Link("todo", "", "")),
      comments: value.comments ?? recordOf({ text: "" }),

      owner: value.owner ?? new Link("company", "", ""),
      manager: value.manager ?? new Link("employed", "", ""),
    };
    return result;
  }

  if (d == "employed") {
    const value = valueUntyped as Partial<NepoEmployment>;
    const result: Required<DestinationTypeMap["employed"]> = {
      name: value.name ?? "",
      parties: value.parties ?? [],

      employments:
        value.employments ??
        recordOf({
          text: "",
          relation: "",
          connection: new Link("company", "", ""),
        }),
      connections:
        value.connections ??
        recordOf({
          text: "",
          relation: "",
          connection: new Link("employed", "", ""),
        }),
      todos: value.todos ?? recordOf(new Link("todo", "", "")),
      comments: value.comments ?? recordOf({ text: "" }),
    };
    return result;
  }

  if (d == "data") {
    const value = valueUntyped as Partial<Article>;
    const result: Required<DestinationTypeMap["data"]> = {
      name: value.name ?? "",
      sourceURL: value.sourceURL ?? "",
      shortName: value.shortName ?? "",
      estimates: value.estimates ?? { mentionedPeople: 0 },
      people: value.people ?? recordOf(new Link("employed", "", "")),
      companies: value.companies ?? recordOf(new Link("company", "", "")),
      date: value.date ?? Date.now(),
      status: value.status ?? {
        tags: [],
        signedUp: {},
        markedDone: {},
        confirmedDone: false,
      },
      todos: value.todos ?? recordOf(new Link("todo", "", "")),
      comments: value.comments ?? recordOf({ text: "" }),
    };
    return result;
  }

  if (d == "todo") {
    const value = valueUntyped as Partial<Todo>;
    const result: Required<DestinationTypeMap["todo"]> = {
      name: value.name ?? "",
      text: value.text ?? "",
      subtasks: value.subtasks ?? recordOf(new Link("todo", "", "")),
    };
    return result;
  }

  if (d == "external/rejestr-io/krs") {
    const value = valueUntyped as Partial<KRSCompany>;
    const result: Required<DestinationTypeMap["external/rejestr-io/krs"]> = {
      name: value.name ?? "",
      connections:
        value.connections ?? recordOf({ state: "aktualne", type: "person" }),
      external_basic: value.external_basic ?? {
        id: "",
        nazwy: { skrocona: "" },
      },
      basic: value.basic ?? { id: "", nazwy: { skrocona: "" } },
    };
    return result;
  }

  if (d == "external/rejestr-io/person") {
    const value = valueUntyped as Partial<PersonRejestr>;
    const result: Required<DestinationTypeMap["external/rejestr-io/person"]> = {
      name: value.name ?? "",
      external_basic: value.external_basic ?? {
        id: "",
        state: "aktualne",
        tozsamosc: { data_urodzenia: "" },
      },
      comment: value.comment ?? recordOf(""),
      link: value.link ?? recordOf(""),

      status: value.status ?? "unknown",
      score: value.score ?? 0,
      person: value.person ?? new Link("employed", "", ""),
    };
    return result;
  }

  throw new Error("Unknown destination type");
}

export function removeBlanks<D extends Destination>(
  obj: DestinationTypeMap[D],
): DestinationTypeMap[D] {
  // Create a new object to avoid mutating the original
  const payload: any = {};

  for (const key in obj) {
    // Ensure the key belongs to the object and not its prototype chain
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key as keyof DestinationTypeMap[D]];

      if (value === null) continue;
      if (value === undefined) continue;
      if (value === "") continue;
      if (value instanceof Link) {
        if (value.id === "") continue;
      }
      if (value instanceof Object) {
        const entries = Object.entries(value);
        if (entries.length === 0) continue;
        if (entries.length === 1) {
          const [k, v] = entries[0];
          if (v instanceof Link) {
            if (v.id === "") continue;
          }
        }
      }

      if (value !== null && value !== undefined && value !== "") {
        payload[key] = value;
      }
    }
  }

  return payload as DestinationTypeMap[D];
}
