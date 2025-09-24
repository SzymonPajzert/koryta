import { computed } from "vue";
import { partyColors } from "~~/shared/misc";

export async function usePartyStatistics() {
  const { entities: people } = await useEntity("person");

  const results = computed<number[]>(() => {
    if (!people.value) return [];

    return Object.keys(partyColors).map((party) => {
      return Object.values(people.value).filter((person) => {
        return (person.parties ?? []).findIndex((p) => p === party) != -1;
      }).length;
    });
  });

  return { results };
}
