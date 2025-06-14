import { ref, computed } from 'vue'
import nepoEmployment from '@/assets/people.json'

export interface NepoEmployment {
  name: string;
  nepotism: Array<{
    relation: string;
    person: {
      name: string;
      role?: string;
      party: string;
    };
    source?: string;
  }>;
  employment: {
    role?: string;
    company?: string;
    source?: string;
    salary?: string;
    additional_info?: string;
  };
  additional_info?: string; // For cases like "Internetowy hejter wspierający PO"
}

export function useListEmployment() {
  const people = ref<NepoEmployment[]>(nepoEmployment as NepoEmployment[])
  return { people };
}

export function usePartyStatistics() {
  const { people } = useListEmployment();

  const parties = ref(["PO", "PiS", "PSL"])
  const partyColors = ref(["#fca241", '#073b76', '#2ed396'])
  const results = computed<number[]>(() => {
    return parties.value.map((party) => {
      return people.value.filter((person) => {
        return person.nepotism.findIndex((nepo) => nepo.person.party == party) != -1;
      }).length
    });
  })

  return { parties, partyColors, results }
}
