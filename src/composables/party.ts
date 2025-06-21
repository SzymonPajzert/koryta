import { ref, computed } from 'vue'
import { useRTDB } from '@vueuse/firebase/useRTDB'
import { db } from '@/firebase'
import { ref as dbRef } from 'firebase/database'

interface Textable {
  text: string
}

export interface NepoEmployment {
  name: string
  parties: string[]
  employments?: Record<string, Textable>
  connections?: Record<string, Textable>
  sources: Record<string, Textable>
  sourceURL: string // TODO get rid of it
  comments?: Record<string, Textable>
}

export function useListEmployment() {
  const peopleRaw = useRTDB<{employed: Record<string, NepoEmployment>}>(dbRef(db, 'employed'))
  const people = computed<Record<string, NepoEmployment>>(() => peopleRaw.value ?? {})
  return { people };
}

export function usePartyStatistics() {
  const { people } = useListEmployment();

  const parties = ref(["PO", "PiS", "PSL", "Polska 2050", "Nowa Lewica", "Konfederacja", "Razem"])
  // TODO '#073b76',  '#102440',
  const partyColors = ref(["#fca241", '#A9D1DF', '#2ed396', '#FFCB03', '#D40E20', '#A9D1DF', '#871057'])
  const results = computed<number[]>(() => {
    return parties.value.map((party) => {
      return Object.values(people.value).filter((person) => {
        return (person.parties ?? []).findIndex((p) => p === party) != -1;
      }).length
    });
  })

  return { parties, partyColors, results }
}
