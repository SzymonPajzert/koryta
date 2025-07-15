import type { Article, Destination, Nameable } from "@/composables/model"
import { useListEntity } from '@/composables/entity'
import type { Ref } from 'vue'
import { compareTwoStrings } from 'string-similarity';

type Entry<D> = [string, D & {similarity: number}]

export function useEntitiesFiltered<D extends Destination>(destination: D, filter: Ref<string>, max?: number) {
  const { entities } = useListEntity(destination)

  const closest = computed(() => {
    if (!filter.value) return []
    if (!entities.value) return []

    const result = Object.entries(entities.value)
      .map(entitySimilarity(destination, filter.value))
      .sort(entitySort())
    return result.slice(0, max)
  })

  return { closest }
}

function entitySimilarity<T extends Nameable, D extends Destination>(d: D, match: string): (a: [string, T]) => Entry<T> {
  return ([key, obj]) => {
    let value = obj.name
    if (d == 'data') {
      // TODO this is badly typed
      value = (obj as unknown as Article).sourceURL
    }
    return [key, {
      ...obj,
      similarity: compareTwoStrings(match, value),
    }]
  }
}

function entitySort<T>(): (a: Entry<T>, b: Entry<T>) => number {
  return (a, b) => {
    return b[1].similarity - a[1].similarity
  }
}
