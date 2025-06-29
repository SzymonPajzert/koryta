import { useRTDB } from '@vueuse/firebase/useRTDB'
import { db } from '@/firebase'
import { ref as dbRef } from 'firebase/database'
import type { NepoEmployment } from './party'

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

type ImprovedLinks = {
  [K in Destination]: Record<string, Link<K>>;
};

export function empty(d: 'employed'): NepoEmployment;
export function empty(d: Destination) {
  if (d == 'employed') {
    return {
      'name': '',
      'comments': {},
      'connections': {},
      'employments': {},
      'sources': {},
      'sourceURL': ''
    }
  }

  return undefined as any
}

export function useListEntity<T extends Nameable>(entity: Destination) {

  const entities = useRTDB<Record<string, T>>(dbRef(db, entity))
  return { entities, empty }
}
