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

  descriptionLen?: number; // Calculated after retrieving from DB

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

  // We precalculate some state for the articles list
  // To not worry about the DB.
  enrichedStatus?: {
    isAssignedToCurrentUser: boolean;
    hideArticle: boolean;
  }
}

interface ArticleStatus {
  signedUp: Record<string, number>
  markedDone: Record<string, number>
  confirmedDone: boolean
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
  data: Article; // TODO
  suggestion: Nameable; // TODO
}

// TODO what does this class do?
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

// TODO do I still need it
type ImprovedLinks = {
  [K in Destination]: Record<string, Link<K>>;
};
