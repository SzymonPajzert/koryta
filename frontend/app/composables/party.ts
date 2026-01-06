import { computed, type Ref } from "vue";
import { partyColors } from "~~/shared/misc";
import type { Person } from "~~/shared/model";

export const usePartyStatistics = async (
  existingPeople?: Ref<Record<string, Person>>,
) => {
  const people = existingPeople || (await useEntity("person")).entities;

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
};
