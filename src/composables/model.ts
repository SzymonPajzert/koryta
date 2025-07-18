import { ref as dbRef, push } from 'firebase/database';
import { db } from '@/firebase'

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

export const destinationIcon: Record<Destination, string> = {
  'employed': 'mdi-account-outline',
  'company': 'mdi-office-building-outline',
  'data': 'mdi-file-document-outline',
  'suggestion': 'mdi-help-circle-outline',
}

export const destinationAddText: Record<Destination, string> = {
  'employed': 'Dodaj osobę',
  'company': 'Dodaj firmę',
  'data': 'Dodaj artykuł',
  'suggestion': 'Dodaj sugestię',
}

export interface NepoEmployment extends Nameable {
  name: string;
  parties?: string[];

  employments: Record<string, Connection>;
  connections: Record<string, Connection>;
  comments: Record<string, Textable>;
}

export interface Company extends Nameable {
  name: string
  owners: Record<string, Link<'company'>>
  // TODO(https://github.com/SzymonPajzert/koryta/issues/44): Migrate away from them
  owner?: Link<'company'>
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
  status: ArticleStatus
}

export const articleTags = ['ludzie wyciągnięci', 'dodatkowe informacje', 'nie łącz w grafie', 'przeczytane'] as const;
type ArticleTag = typeof articleTags[number];

interface ArticleStatus {
  tags: ArticleTag[]

  signedUp: Record<string, number>
  markedDone: Record<string, number>
  confirmedDone: boolean
}

export function newKey() {
  const newKey = push(dbRef(db, '_temp_keys/employments')).key;
  if (!newKey) {
    throw "Failed to create a key"
  }
  return newKey
}


function clearEmptyRecord(record: Record<string, {text: string}>) {
  // TODO(https://github.com/SzymonPajzert/koryta/issues/45): Implement
}

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
    return value
  }
  if (d == 'company') {
    const value = valueUntyped as Company
    if (!value.owners) {
      if (value.owner) value.owners = recordOf(value.owner)
      else value.owners = recordOf(new Link("company", '', ''))
    }
    value.comments = {}
    // TODO(https://github.com/SzymonPajzert/koryta/issues/45): remove this return and see if tests fail
    return value
  }
  if (d == 'suggestion') {
    return valueUntyped as Nameable
  }
  if (d == 'data') {
    const value = valueUntyped as Article
    if (!value.comments) value.comments = recordOf({ text: ''})
    if (!value.companies) value.companies = recordOf(new Link("company", '', ''))
    if (!value.people) value.people = recordOf(new Link("employed", '', ''))
    if (!value.estimates) value.estimates = {}
    if (!value.status) value.status = {tags: [], signedUp: {}, markedDone: {}, confirmedDone: false}
    return value
  }

  return undefined as any
}

export function removeBlankRecords<D extends Destination>(valueUntyped: DestinationTypeMap[D], d: D): DestinationTypeMap[D];
export function removeBlankRecords<D extends Destination>(valueUntyped: DestinationTypeMap[D], d: D) {
  if (d == 'employed') {
    const value = valueUntyped as NepoEmployment
    clearEmptyRecord(value.comments)
    clearEmptyRecord(value.connections)
    clearEmptyRecord(value.employments)
    return value
  }
  if (d == 'company') {
    const value = valueUntyped as Company
    clearEmptyRecord(value.owners)
    clearEmptyRecord(value.comments)
    // TODO(https://github.com/SzymonPajzert/koryta/issues/45) remove this return and see if tests fail
    return value
  }
  if (d == 'suggestion') {
    return valueUntyped as Nameable
  }
  if (d == 'data') {
    const value = valueUntyped as Article
    clearEmptyRecord(value.comments)
    clearEmptyRecord(value.companies)
    clearEmptyRecord(value.people)
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
    }
    return result
  }
  if (d == 'company') {
    const result: Company = {
      name: '',
      owners: {},
      comments: {},
    }
    return result
  }
  if (d == 'data') {
    const result: Article = {
      name: '',
      sourceURL: '',
      comments: {},
      people: {},
      companies: {},
      estimates: {},
      status: {tags: [], signedUp: {}, markedDone: {}, confirmedDone: false},
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
  suggestion: Nameable;
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
