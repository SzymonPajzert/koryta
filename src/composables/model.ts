import { ref as dbRef, push } from "firebase/database";
import { db } from "@/firebase";

export interface Textable {
  text: string;
}
export interface Nameable {
  name: string;
  // If set, the name will be used as the url
  isStable?: boolean;
  // If isStable and stablePath is set, use the path instead of the name
  stablePath?: string[];
}
export interface Connection {
  text: string;
  connection?: Link<Destination>;
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

  employments: Record<string, Connection>;
  connections: Record<string, Connection>;

  todos: Record<string, Link<"todo">>;
  comments: Record<string, Textable>;
}

export interface Company extends Nameable {
  name: string;
  owners: Record<string, Link<"company">>;
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

export interface PersonRejestr extends Nameable {
  // TODO move these to proper fields, instead of the ingested external basic
  external_basic: {
    id: string;
    state: "aktualne" | "historyczne"
    tozsamosc: {
      data_urodzenia: string
    }
  }

  comment?: Record<string, string>;
  link?: Record<string, string>;
  score ?: number
  person ?: Link<"employed">
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
  "external/rejestr-io/krs": any;
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

// TODO: Implement this function as per your issue tracker
function clearEmptyRecord(record: Record<string, any>) {
  // ...
}

/**
 * Base class for all entities, implementing the common Nameable interface.
 */
abstract class EntityModel<D extends Destination> implements Nameable {
  destination: D;
  name: string;

  constructor(destination: D, data: Partial<Nameable>) {
    this.destination = destination;
    this.name = data.name ?? "";
  }

  /** Fills required fields with empty defaults. */
  abstract fillBlanks(): ModelMap[D];

  /** Removes empty/placeholder records before saving. */
  abstract removeBlanks(): ModelMap[D];
}

/**
 * An abstract class for entities that have 'todos' and 'comments' fields.
 */
abstract class CommentableModel<D extends Destination> extends EntityModel<D> {
  todos: Record<string, Link<"todo">>;
  comments: Record<string, Textable>;

  constructor(d: D, data: Partial<Company | Article | NepoEmployment>) {
    super(d, data);
    this.todos = data.todos ?? {};
    this.comments = data.comments ?? {};
  }

  protected fillCommonBlanks(): void {
    if (Object.keys(this.comments).length === 0) {
      this.comments = recordOf({ text: "" });
    }
  }

  protected removeCommonBlanks(): void {
    clearEmptyRecord(this.comments);
  }
}

class NepoEmploymentModel
  extends CommentableModel<"employed">
  implements NepoEmployment
{
  parties?: string[];
  employments: Record<string, Connection>;
  connections: Record<string, Connection>;

  constructor(data: Partial<NepoEmployment> = {}) {
    super("employed", data);
    this.parties = data.parties;
    this.employments = data.employments ?? {};
    this.connections = data.connections ?? {};
  }

  fillBlanks(): this {
    this.fillCommonBlanks();
    if (Object.keys(this.connections).length === 0) {
      this.connections = recordOf({ text: "", relation: "" });
    }
    if (Object.keys(this.employments).length === 0) {
      this.employments = recordOf({ text: "", relation: "" });
    }
    return this;
  }

  removeBlanks(): this {
    this.removeCommonBlanks();
    if (!this.parties) this.parties = [];
    clearEmptyRecord(this.connections);
    clearEmptyRecord(this.employments);
    return this;
  }
}

class CompanyModel extends CommentableModel<"company"> implements Company {
  owners: Record<string, Link<"company">>;
  owner?: Link<"company">;
  manager?: Link<"employed">;

  constructor(data: Partial<Company> = {}) {
    super("company", data);
    this.owners = data.owners ?? {};
    this.owner = data.owner;
    this.manager = data.manager;
  }

  fillBlanks(): this {
    this.fillCommonBlanks();
    if (Object.keys(this.owners).length === 0) {
      if (this.owner) this.owners = recordOf(this.owner);
      else this.owners = recordOf(new Link("company", "", ""));
    }
    return this;
  }

  removeBlanks(): this {
    this.removeCommonBlanks();
    clearEmptyRecord(this.owners);
    if (!this.owner) this.owner = undefined;
    if (!this.manager) this.manager = undefined;
    return this;
  }
}

class ArticleModel extends CommentableModel<"data"> implements Article {
  sourceURL: string;
  people: Record<string, Link<"employed">>;
  companies: Record<string, Link<"company">>;
  shortName?: string;
  estimates: { mentionedPeople?: number };
  date?: number;
  status: ArticleStatus;

  constructor(data: Partial<Article> = {}) {
    super("data", data);
    this.sourceURL = data.sourceURL ?? "";
    this.people = data.people ?? {};
    this.companies = data.companies ?? {};
    this.shortName = data.shortName;
    this.estimates = data.estimates ?? {};
    this.status = data.status ?? {
      tags: [],
      signedUp: {},
      markedDone: {},
      confirmedDone: false,
    };
  }

  fillBlanks(): this {
    this.fillCommonBlanks();
    if (Object.keys(this.companies).length === 0) {
      this.companies = recordOf(new Link("company", "", ""));
    }
    if (Object.keys(this.people).length === 0) {
      this.people = recordOf(new Link("employed", "", ""));
    }
    return this;
  }

  removeBlanks(): this {
    this.removeCommonBlanks();
    if (!this.shortName) this.shortName = undefined;
    if (!this.date) this.date = undefined;
    if (!this.estimates.mentionedPeople)
      this.estimates.mentionedPeople = undefined;
    if (!this.status.tags) this.status.tags = [];
    if (!this.status.signedUp) this.status.signedUp = {};
    if (!this.status.markedDone) this.status.markedDone = {};
    if (this.status.confirmedDone === undefined)
      this.status.confirmedDone = false;
    if (!this.sourceURL) this.sourceURL = "";
    if (this.estimates.mentionedPeople === undefined) this.estimates = {}
    clearEmptyRecord(this.companies);
    clearEmptyRecord(this.people);
    return this;
  }
}

class TodoModel extends EntityModel<"todo"> implements Todo {
  text: string;
  subtasks: Record<string, Link<"todo">>;

  constructor(data: Partial<Todo> = {}) {
    super("todo", data);
    this.text = data.text ?? "";
    this.subtasks = data.subtasks ?? {};
  }

  fillBlanks(): this {
    if (Object.keys(this.subtasks).length === 0) {
      this.subtasks = recordOf(new Link("todo", "", ""));
    }
    return this;
  }

  removeBlanks(): this {
    clearEmptyRecord(this.subtasks);
    return this;
  }
}

interface ModelMap {
  employed: NepoEmploymentModel;
  company: CompanyModel;
  data: ArticleModel;
  todo: TodoModel;
  "external/rejestr-io/krs": any;
  "external/rejestr-io/person": any;
}

const modelMap = {
  employed: NepoEmploymentModel,
  company: CompanyModel,
  data: ArticleModel,
  todo: TodoModel,
  "external/rejestr-io/krs": Object,
  "external/rejestr-io/person": Object,
};

function createModel<D extends Destination>(
  destination: D,
  data?: Partial<DestinationTypeMap[D]>,
): ModelMap[D] & EntityModel<D>;
function createModel<D extends Destination>(
  destination: D,
  data?: Partial<DestinationTypeMap[D]>,
) {
  const ModelClass = modelMap[destination];
  // The 'any' cast is a pragmatic choice here to handle the dynamic nature of the factory.
  return new ModelClass(data as any);
}

export function empty<D extends Destination>(d: D): DestinationTypeMap[D] {
  // Spread the class instance to return a plain object
  return { ...createModel(d) };
}

export function fillBlankRecords<D extends Destination>(
  value: Partial<DestinationTypeMap[D]>,
  d: D,
): DestinationTypeMap[D] {
  const model: EntityModel<D> = createModel(d, value);
  // The fillBlanks method returns the instance, so spread it to get a plain object
  return { ...model.fillBlanks() };
}

export function removeBlankRecords<D extends Destination>(
  value: DestinationTypeMap[D],
  d: D,
): DestinationTypeMap[D] {
  const model: EntityModel<D> = createModel(d, value);
  return { ...model.removeBlanks() };
}
