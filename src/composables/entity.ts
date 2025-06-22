import { useRTDB } from '@vueuse/firebase/useRTDB'
import { db } from '@/firebase'
import { ref as dbRef } from 'firebase/database'

export interface Textable {
  text: string
}

export interface Nameable {
  name: string
}

export type Destination = 'employed' | 'company'

export class Linkable<T extends Destination> {
  public readonly type: T;
  constructor(type: T) { this.type = type; }
}

type ImprovedLinks = {
  [K in Destination]: Record<string, Linkable<K>>;
};

export function useListEntity(entity: Destination) {
  const entities = useRTDB<Record<string, Nameable>>(dbRef(db, entity))
  watch(entities, console.log)
  return { entities }
}
