import { type Ref } from "vue";
import { createEntityStore } from "@/stores/entity";

export function useCompanyScore(firstChance: Ref<number>, ignoreSuccess: Ref<number>) {
  const useCompanyStore = createEntityStore("external/rejestr-io/krs");
  const companyStore = useCompanyStore();
  const { entities: companies } = storeToRefs(companyStore);

  const usePeopleStore = createEntityStore("external/rejestr-io/person");
  const peopleStore = usePeopleStore();
  const { entities: people } = storeToRefs(peopleStore);

  const scores = computed(() => {

  })
}
