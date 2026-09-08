import { computed, unref } from "vue";
import type { Ref } from "vue";
import type { PersonRich } from "~~/shared/model";

/** How many location-qualified queries a person is worth. See
 * `uniqueLocations`. */
const MAX_LOCATION_QUERIES = 6;

/** What every "eksploruj wszystko" button says on hover. One string, because
 * the warning about pop-up blocking is the whole reason the tooltip is there
 * and a reader who met it in the table should meet the same words again on the
 * person's own page. */
export const SEARCH_ALL_TOOLTIP =
  "Otwiera wiele kart wyszukiwania jednocześnie. Upewnij się, że blokowanie okienek (pop-up) jest wyłączone.";

/** One thing „eksploruj" would open, named so it can be offered on its own.
 *
 * `searchAll` opens every one of these, so a caller that lists them is listing
 * exactly what the button does rather than a second guess at it - which is what
 * went wrong the first time the drawer tried to reproduce the set and knew
 * about the Google queries but not about the registers. */
export type PersonSearchTarget = {
  /** Stable within one person, for a `v-for` key. */
  key: string;
  /** What the entry says when it is offered by name. */
  label: string;
  /** Which service, for the icon beside it. */
  source: "rejestr" | "wikipedia" | "google";
  url: string;
};

export const usePersonSearch = (
  person: Ref<PersonRich | undefined> | PersonRich | undefined,
  region?: Ref<[string, string] | undefined> | [string, string] | undefined,
  company?: Ref<[string, string] | undefined> | [string, string] | undefined,
  /** Cities to search alongside the ones the person carries, for a caller that
   * worked them out itself - the drawer derives them from the edges it already
   * fetched, which covers nodes that never went through the table. */
  extraLocations?: Ref<string[] | undefined> | string[] | undefined,
) => {
  const personRef = computed(() => unref(person));
  const regionRef = computed(() => unref(region));
  const companyRef = computed(() => unref(company));
  const extraLocationsRef = computed(() => unref(extraLocations));

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

  const nameWithoutMiddle = computed(() => {
    if (!personRef.value?.name) {
      return undefined;
    }
    const nameParts = personRef.value.name.trim().split(/\s+/);
    let nameWithoutMiddle = personRef.value.name;
    if (nameParts.length > 2) {
      nameWithoutMiddle = `${nameParts[0]} ${nameParts[nameParts.length - 1]}`;
    }
    return nameWithoutMiddle;
  });

  /** Every place a person is tied to, in the order a searcher would try them.
   *
   * Where they stood for election first - that is the town they asked to
   * represent - then where they have worked, which is what puts a local paper's
   * coverage of a spółka komunalna within reach of the same name. The two
   * overlap often enough to be worth deduplicating: a councillor employed by
   * their own gmina would otherwise get the same query twice.
   *
   * Capped, because `searchAll` opens a browser tab per query and a long career
   * across a województwo would otherwise open a dozen at once - past which the
   * browser starts blocking them anyway.
   */
  const uniqueLocations = computed(() => {
    const locations = [
      ...(personRef.value?.elections ?? []).map((e) => e.location),
      ...(personRef.value?.workLocations ?? []),
      ...(extraLocationsRef.value ?? []),
    ].filter(Boolean) as string[];
    return Array.from(new Set(locations)).slice(0, MAX_LOCATION_QUERIES);
  });

  const queries = computed(() => {
    const result = [];
    if (personRef.value?.name) {
      result.push(personRef.value.name);
      result.push(personRef.value.name + " PKW");

      if (uniqueLocations.value.length > 0) {
        for (const loc of uniqueLocations.value) {
          result.push(`${nameWithoutMiddle.value} ${loc}`);
        }
      }
    }

    return result;
  });

  const googleUrl = (query: string) =>
    `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  const searchInGoogle = (query?: string) => {
    window.open(googleUrl(query || getQueryParts().join(" ")), "_blank");
  };

  /** Everything „eksploruj" reaches for, in the order a searcher would try it:
   * the registers that answer whether this is even the right person, then the
   * queries that say what has been written about them.
   *
   * The page a person carries wins over a search for their name - that link was
   * put there by somebody who had already found them, and `rejestr.io` will not
   * necessarily find them again. Wikipedia without one is two queries rather
   * than one, because the encyclopedia indexes „Jan Kowalski" and the register
   * knows him as „Jan Maria Kowalski". */
  const searchTargets = computed<PersonSearchTarget[]>(() => {
    const person = personRef.value;
    if (!person?.name) return [];

    const name = encodeURIComponent(person.name);
    const targets: PersonSearchTarget[] = [
      {
        key: "rejestr",
        label: person.rejestrIo ? "rejestr.io - strona osoby" : "rejestr.io",
        source: "rejestr",
        url: person.rejestrIo || `https://rejestr.io/krs?q=${name}`,
      },
    ];

    if (person.wikipedia) {
      targets.push({
        key: "wikipedia",
        label: "Wikipedia - strona osoby",
        source: "wikipedia",
        url: person.wikipedia,
      });
    } else {
      targets.push({
        key: "wikipedia",
        label: `Wikipedia: ${person.name}`,
        source: "wikipedia",
        url: `https://pl.wikipedia.org/wiki/Special:Search?search=${name}`,
      });
      if (nameWithoutMiddle.value && nameWithoutMiddle.value !== person.name) {
        targets.push({
          key: "wikipedia-short",
          label: `Wikipedia: ${nameWithoutMiddle.value}`,
          source: "wikipedia",
          url: `https://pl.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(
            nameWithoutMiddle.value,
          )}`,
        });
      }
    }

    for (const query of queries.value) {
      targets.push({
        key: `google:${query}`,
        label: query,
        source: "google",
        url: googleUrl(query),
      });
    }

    return targets;
  });

  const searchAll = () => {
    for (const target of searchTargets.value) {
      window.open(target.url, "_blank");
    }
  };

  return {
    queries,
    searchTargets,
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
  // The cities come off `person.workLocations`, which the table's rows carry -
  // there are no edges to derive them from at this call site.
  const { searchAll } = usePersonSearch(person, region, company);
  searchAll();
};
