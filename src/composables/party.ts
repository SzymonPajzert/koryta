import { ref } from 'vue'

export function usePartyStatistics() {
  const parties = ref(["PO", "PiS", "PSL"])
  const partyColors = ref(["#fca241", '#073b76', '#2ed396'])
  const results = ref([5, 1, 150])

  return { parties, partyColors, results }
}
