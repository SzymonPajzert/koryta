import { useSuggestDB } from "@/composables/suggestDB";

export interface Textable {
  text: string;
}
export interface Nameable {
  name: string;
}
export interface Connection {
  text: string;
  connection?: Link<Destination>;
  relation: string;
}

export type Destination = "employed" | "company" | "data" | "suggestion";

export interface NepoEmployment extends Nameable {
  name: string;
  parties?: string[];

  sourceURL: string; // TODO get rid of it

  sources: Record<string, Link<'data'>>;
  employments: Record<string, Connection>;
  connections: Record<string, Connection>;
  comments: Record<string, Textable>;
}

export interface Company extends Nameable {
  name: string
  owners: Record<string, Link<'company'>>
  owner?: Link<'company'> // TODO(migrate-db) deprecate this field, prefer owners
  manager?: Link<'employed'>
  comments: Record<string, Textable>
}

export interface Article extends Nameable {
  sourceURL: string,
  comments: Record<string, Textable>
  people: Record<string, Link<'employed'>>
  companies: Record<string, Link<'company'>>

  shortName?: string
  estimates: {
    mentionedPeople?: number
  }

  date?: number;
  status?: ArticleStatus;
}

interface ArticleStatus {
  signedUp: Record<string, number>;
  markedDone: Record<string, number>;
  confirmedDone: boolean;
}

const { newKey } = useSuggestDB();

function recordOf<T>(value: T): Record<string, T> {
  const result: Record<string, T> = {};
  result[newKey()] = value;
  return result;
}

// TODO(cleanup) this seems like it could be a class
// I just don't know how we could do it  and even if this is better to do
// we're mainly using interfaces elsewhere and it seems to work

export function fillBlankRecords<D extends Destination>(valueUntyped: DestinationTypeMap[D], d: D): DestinationTypeMap[D];
export function fillBlankRecords<D extends Destination>(valueUntyped: DestinationTypeMap[D], d: D) {
  if (d == 'employed') {
    const value = valueUntyped as NepoEmployment
    if (!value.comments) value.comments = recordOf({ text: ''})
    if (!value.connections) value.connections = recordOf({text: '', relation: ''})
    if (!value.employments) value.employments = recordOf({text: '', relation: ''})
    if (!value.sources) value.sources = recordOf(new Link("data", '', ''))
    return value
  }
  if (d == 'company') {
    const value = valueUntyped as Company
    if (!value.owners) {
      if (value.owner) value.owners = recordOf(value.owner)
      else value.owners = recordOf(new Link("company", '', ''))
    }
    value.comments = {}
    return value // TODO(cleanup) remove this return - some check should start failing
  }
  if (d == "suggestion") {
    return valueUntyped as Nameable;
  }
  if (d == 'data') {
    const value = valueUntyped as Article
    if (!value.comments) value.comments = recordOf({ text: ''})
    if (!value.companies) value.companies = recordOf(new Link("company", '', ''))
    if (!value.people) value.people = recordOf(new Link("employed", '', ''))
    if (!value.estimates) value.estimates = {}
    return value
  }

  return undefined as any;
}

export function empty<D extends Destination>(d: D): DestinationTypeMap[D];
export function empty(d: Destination) {
  if (d == "employed") {
    const result: NepoEmployment = {
      name: "",
      comments: {},
      connections: {},
      employments: {},
      sources: {},
      sourceURL: "",
    };
    return result;
  }
  if (d == "company") {
    const result: Company = {
      name: '',
      owners: {},
      comments: {},
    }
    return result
  }
  if (d == "data") {
    const result: Article = {
      name: '',
      sourceURL: '',
      comments: {},
      people: {},
      companies: {},
      estimates: {},
    }
    return result
  }
  if (d == "suggestion") {
    const result: Nameable = {
      name: "",
    };
    return result;
  }
  return undefined as any;
}

export interface DestinationTypeMap {
  employed: NepoEmployment;
  company: Company;
  data: Article;
  suggestion: Nameable; // TODO
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
