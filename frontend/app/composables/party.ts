import { computed, type Ref } from "vue";
import { partyColors } from "~~/shared/misc";

export function usePartyStatistics(existingPeople?: Ref<Record<string, any>>) {
  const people = existingPeople || useEntity("person").entities;

  const results = computed<number[]>(() => {
    if (!people.value) return [];

    return (Object.keys(partyColors) as (keyof typeof partyColors)[]).map(
      (party) => {
        return Object.values(people.value).filter((person) => {
          return (person.parties ?? []).includes(party);
        }).length;
      },
    );
  });

  return { results };
}
