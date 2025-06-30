import { useSuggestDB } from '@/composables/suggestDB'

export interface Textable {
  text: string
}
export interface Nameable {
  name: string
}
export interface Connection {
  text: string;
  connection?: Link<Destination>;
  relation: string;
}

export type Destination = 'employed' | 'company' | 'data' | 'suggestion'

export interface NepoEmployment extends Nameable {
  name: string;
  parties?: string[];

  sourceURL: string; // TODO get rid of it

  sources: Record<string, Textable>;
  employments: Record<string, Connection>;
  connections: Record<string, Connection>;
  comments: Record<string, Textable>;
}

export interface Company extends Nameable {
  name: string
  owner?: Link<'company'>
  manager?: Link<'employed'>
}

export interface Article extends Nameable {
  sourceURL: string,
  comments: Record<string, Textable>

  date?: number;
  status?: ArticleStatus
}

interface ArticleStatus {
  signedUp: Record<string, number>
  markedDone: Record<string, number>
  confirmedDone: boolean
}

const { newKey } = useSuggestDB();

function recordOf<T>(value: T): Record<string, T> {
  const result: Record<string, T>= {}
  result[newKey()] = value
  return result
}

export function fillBlankRecords<D extends Destination>(valueUntyped: DestinationTypeMap[D], d: D): DestinationTypeMap[D];
export function fillBlankRecords<D extends Destination>(valueUntyped: DestinationTypeMap[D], d: D) {
  if (d == 'employed') {
    const value = valueUntyped as NepoEmployment
    if (!value.comments) value.comments = recordOf({ text: ''})
    if (!value.connections) value.connections = recordOf({text: '', relation: ''})
    if (!value.employments) value.employments = recordOf({text: '', relation: ''})
    if (!value.sources) value.sources = recordOf({text: ''})
    return value
  }
  if (d == 'company') {
    return valueUntyped as Company
  }
  if (d == 'suggestion') {
    return valueUntyped as Nameable
  }
  if (d == 'data') {
    const value = valueUntyped as Article
    if (!value.comments) value.comments = recordOf({ text: ''})
    return value
  }

  return undefined as any
}


export function empty<D extends Destination>(d: D): DestinationTypeMap[D];
export function empty(d: Destination) {
  if (d == 'employed') {
    const result: NepoEmployment = {
      'name': '',
      'comments': {},
      'connections': {},
      'employments': {},
      'sources': {},
      'sourceURL': ''
    }
    return result
  }
  if (d == 'company') {
    const result: Company = {
      name: ''
    }
    return result
  }
  if (d == 'data') {
    const result: Article = {
      name: '',
      sourceURL: '',
      comments: {}
    }
    return result
  }
  if (d == 'suggestion') {
    const result: Nameable = {
      name: ''
    }
    return result
  }
  return undefined as any
}

export interface DestinationTypeMap {
  employed: NepoEmployment;
  company: Company;
  data: Article;
  suggestion: Nameable; // TODO
}

export class Link<T extends Destination> {
  public readonly type: T;
  public readonly id: string
  public readonly text: string
  constructor(type: T, id: string, text: string) {
    this.type = type;
    this.id = id;
    this.text = text
  }
}
