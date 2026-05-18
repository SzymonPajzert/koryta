import { computed, unref } from "vue";
import type { Ref } from "vue";
import type { PersonRich } from "~~/shared/model";

export const usePersonSearch = (
  person: Ref<PersonRich | undefined> | PersonRich | undefined,
  region?: Ref<[string, string] | undefined> | [string, string] | undefined,
  company?: Ref<[string, string] | undefined> | [string, string] | undefined,
) => {
  const personRef = computed(() => unref(person));
  const regionRef = computed(() => unref(region));
  const companyRef = computed(() => unref(company));

  const getQueryParts = () => {
    const parts = [personRef.value?.name];
    if (regionRef.value) {
      parts.push(regionRef.value[1]);
    }
    if (companyRef.value) {
      parts.push(companyRef.value[1]);
    }
    return parts.filter(Boolean) as string[];
  };

  const uniqueLocations = computed(() => {
    if (!personRef.value?.elections) return [];
    const locations = personRef.value.elections
      .map((e) => e.location)
      .filter(Boolean) as string[];
    return Array.from(new Set(locations));
  });

  const queries = computed(() => {
    const result = [];
    if (personRef.value?.name) {
      result.push(personRef.value.name);
      result.push(personRef.value.name + " PKW");

      if (uniqueLocations.value.length > 0) {
        const nameParts = personRef.value.name.trim().split(/\s+/);
        let nameWithoutMiddle = personRef.value.name;
        if (nameParts.length > 2) {
          nameWithoutMiddle = `${nameParts[0]} ${nameParts[nameParts.length - 1]}`;
        }

        for (const loc of uniqueLocations.value) {
          result.push(`${nameWithoutMiddle} ${loc}`);
        }
      }
    }

    return result;
  });

  const searchInGoogle = (query?: string) => {
    const searchQuery = encodeURIComponent(query || getQueryParts().join(" "));
    window.open(`https://www.google.com/search?q=${searchQuery}`, "_blank");
  };

  const searchAll = () => {
    if (!personRef.value?.name) return;

    const name = encodeURIComponent(personRef.value.name);
    window.open(`https://rejestr.io/krs?q=${name}`, "_blank");
    window.open(
      `https://pl.wikipedia.org/wiki/Special:Search?search=${name}`,
      "_blank",
    );

    for (const query of queries.value) {
      searchInGoogle(query);
    }
  };

  return {
    queries,
    getQueryParts,
    searchInGoogle,
    searchAll,
  };
};

export const executeSearchAll = (
  person: PersonRich,
  region?: [string, string],
  company?: [string, string],
) => {
  const { searchAll } = usePersonSearch(person, region, company);
  searchAll();
};
