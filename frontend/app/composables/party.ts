import { ref, computed } from "vue";
import { createEntityStore } from "../stores/entity";
import { partyColors } from "~/../shared/misc";

export function usePartyStatistics() {
  const useListEntity = createEntityStore("employed");
  const entityStore = useListEntity();
  const { entities: people } = storeToRefs(entityStore);

  const parties = ref<string[]>([
    "PO",
    "PiS",
    "PSL",
    "Polska 2050",
    "Nowa Lewica",
    "Konfederacja",
    "Razem",
  ]);

  const results = computed<number[]>(() => {
    return Object.keys(partyColors).map((party) => {
      return Object.values(people.value).filter((person) => {
        return (person.parties ?? []).findIndex((p) => p === party) != -1;
      }).length;
    });
  });

  return { parties, partyColors, results };
}
