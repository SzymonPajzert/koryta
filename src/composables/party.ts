import { ref, computed, watch } from 'vue'
import { useReadDB } from '@/composables/staticDB'

interface Textable {
  text: string
}

export interface NepoEmployment {
  name: string
  parties: string[]
  employments: Record<string, Textable>
  connections: Record<string, Textable>
  source: string
  comments: Record<string, Comment>
}

export function useListEmployment() {
  const { watchPath } = useReadDB<{employed: Record<string, NepoEmployment>}>()
  const peopleRaw = watchPath<Record<string, NepoEmployment>>("employed")
  const people = computed<Record<string, NepoEmployment>>(() => peopleRaw.value ?? {})
  return { people };
}

export function usePartyStatistics() {
  const { people } = useListEmployment();

  const parties = ref(["PO", "PiS", "PSL"])
  const partyColors = ref(["#fca241", '#073b76', '#2ed396'])
  const results = computed<number[]>(() => {
    return parties.value.map((party) => {
      return Object.values(people.value).filter((person) => {
        return (person.parties ?? []).findIndex((p) => p === party) != -1;
      }).length
    });
  })

  return { parties, partyColors, results }
}
