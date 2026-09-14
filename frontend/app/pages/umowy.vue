<template>
  <div>
    <h1 class="text-h5 text-sm-h4 mb-1">Umowy publiczne: kto komu zapłacił</h1>

    <!-- A fresh environment, before the register has been ingested. One note
         and nothing else: a headline reading „0 umów" over an empty feed with a
         filter bar above it looks like a page that failed, not like a page with
         nothing in it yet. -->
    <div v-if="empty" class="k-note" data-testid="umowy-blank">
      <p class="text-body-2 mb-0">
        Nie wczytaliśmy jeszcze żadnych umów. Pojawią się tutaj, gdy pobierzemy
        Centralny Rejestr Umów.
      </p>
    </div>

    <template v-else>
      <p class="text-body-2 text-ink-neutral mb-3">
        Umowy z Centralnego Rejestru Umów — wszystkie, które pobraliśmy. Przy
        części z nich umiemy dopisać instytucję albo spółkę opisaną na
        koryta.pl.
      </p>

      <ContractHeadline v-if="coverage" :coverage="coverage" />

      <ContractFilters v-model:sort="sort" v-model:zakres="zakres" />

      <!-- The same single column at every width. A contract card is a two-line
           subject and two party lines; stretched across a 1200px monitor it is
           a sentence with 900px of nothing after it, and a table of 149 683
           register rows is not what this page is for. -->
      <div class="umowy__list">
        <ContractFeed
          :query="query"
          empty-text="Żadna umowa nie pasuje do tych filtrów."
          @reset="zakres = 'wszystkie'"
        />
      </div>

      <ContractSourceNote v-if="coverage" :coverage="coverage" class="mt-6" />
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  CONTRACT_PARAM,
  useContractList,
  type ContractScope,
  type ContractSort,
} from "~/composables/contracts";

/** The public list of contracts.
 *
 * Server rendered, indexable, phone first, and with no `<ClientOnly>` anywhere
 * in it - the whole point of the feature is that a stranger arriving from a
 * search reads the register without an account. Nothing on this page is gated,
 * because `/api/contracts` attaches no person data to anybody: a reader reaches
 * people by tapping „Szczegóły umowy" or by following an institution link.
 */
definePageMeta({ maxWidth: 1200 });

const { choiceFilter } = useQueryFilters({
  // Changing a filter re-orders the list, so the row a `?umowa=` link pointed
  // at is no longer the row it opens. Dropping the parameter is what stops an
  // unrelated contract expanding itself after a sort.
  resetOnChange: [CONTRACT_PARAM],
});

/** Both live in the url, because a filtered list is a link somebody sends. The
 * cursor does not: it would make a shared link point at page four of an
 * ordering that has since moved. */
const sort = choiceFilter<ContractSort>("sort", "data");
const zakres = choiceFilter<ContractScope>("zakres", "wszystkie");

const query = computed(() => ({ sort: sort.value, zakres: zakres.value }));

// The same key `ContractFeed` builds from the same query, so the page and the
// feed inside it share one async-data entry and therefore one request. The page
// wants the coverage half of the answer - it renders above the feed, so it
// cannot wait for a child to hand it over - and the feed wants the rows.
const { data } = useContractList(query);
const coverage = computed(() => data.value?.coverage ?? null);

/** Nothing ingested at all, as distinct from nothing matching a filter. Only
 * ever true against a fresh stack; `coverage` is null until the first response
 * lands, and a null one is not an empty one. */
const empty = computed(() => coverage.value?.total === 0);

const description =
  "Umowy z Centralnego Rejestru Umów - wszystkie, które pobraliśmy. Przy części z nich umiemy dopisać instytucję albo spółkę opisaną na koryta.pl i powiedzieć, kto w niej zasiada.";

useSeoMeta({
  title: "Umowy publiczne: kto komu zapłacił - koryta.pl",
  description,
  ogTitle: "Umowy publiczne: kto komu zapłacił",
  ogDescription: description,
});

// Always the bare `/umowy`, whatever `?sort`, `?zakres` or `?umowa` says. Four
// orderings of the same 149 683 rows are four near-duplicate crawl targets and
// every shared expanded-row link would be a fifth; one crawlable url, one
// sitemap entry, and the filters stay shareable because a 302 nobody issues
// cannot be cached wrong.
useHead({ link: [{ rel: "canonical", href: "https://koryta.pl/umowy" }] });
</script>

<style scoped>
/* Centred in the layout's 1200px container rather than filling it. 900px is
   about 100 characters of the subject line at this type size, which is where a
   line stops being comfortable to read. */
.umowy__list {
  max-width: 900px;
}
</style>
