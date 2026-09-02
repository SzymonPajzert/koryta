<template>
  <ClientOnly>
    <!-- Whatever this page can do to a person's relations, /eksploruj/nowe can
         do too, in its own shape - see `.agent/skills/relation-surfaces.md`. -->
    <ExploreNodeDrawer
      v-model="openDrawer"
      :node="focusedPerson"
      :edges="focusedEdges"
      :region="region"
      :company="company"
      :company-regions="companyRegions"
      @changed="refreshFocusedEdges()"
    />
    <div class="pa-4">
      <!-- The whole chrome of this page, in one 44px bar (plus a 32px work row
           for a reader who is signed in). It carries the h1, the filters, a
           chip per filter that is narrowing the table, the row count, the sort
           and the share link. What used to be here - a three line title, six
           always open dropdowns, a progress card - put the first row of data
           697px down a 1440px desktop and 588px down a 390px phone.

           The row count goes up only when the reader has changed it:
           `shareUrl` drops `page=1` by itself but has no default row count to
           compare against, so the share card would offer „Dołącz stronę i
           liczbę wierszy” on an untouched first page and ticking it would add
           `itemsPerPage=10`, which is what the recipient gets anyway. -->
      <FormEksplorujTabelaFilters
        v-model:visibility="filterVisibility"
        v-model:party="filterParty"
        v-model:teryt="filterTeryt"
        v-model:company-teryt="filterCompanyTeryt"
        v-model:place="filterPlace"
        v-model:category="filterCategory"
        v-model:hide-voted="filterHideVoted"
        v-model:currently-employed="filterCurrentlyEmployed"
        v-model:min-employment-date="filterMinEmploymentDate"
        v-model:min-votes="filterMinVotes"
        v-model:sort-by="sortBy"
        :available-parties="availableParties"
        :available-regions="availableRegions"
        :available-companies="availableCompanies"
        :show-visibility="!!user"
        :total-items="totalItems"
        :page="page"
        :items-per-page="
          itemsPerPage === DEFAULT_ITEMS_PER_PAGE ? undefined : itemsPerPage
        "
        :progress-query="apiQuery"
        :show-progress="!!user"
        show-share
        @clear="clearFilters"
        @share="trackGoal('tabela:shared')"
      />

      <v-card class="table-card">
        <ExploreTable
          v-model:items-per-page="itemsPerPage"
          v-model:page="page"
          v-model:sort-by="sortBy"
          :headers="headers"
          :items="tableItems"
          :total-items="totalItems"
          :pending="pending"
          :region="region"
          :company="company"
          search-with-name
          score-on-phone
          :draft-with-name="!!user"
          @focus="focusPerson"
        />
      </v-card>

      <!-- Below the table on purpose, all three of them. None answers the
           question the reader came with - which people are in here - and above
           the table they were answering it last: the banner and the alert are
           addressed to somebody who has already looked, and the list of
           selected companies repeats what the „Firmy” chips on the bar now
           say. A reader who has read a screenful of rows is exactly the one
           who might log in or donate. -->
      <ExploreLoginBanner
        v-if="!user"
        :hidden-count="hiddenCount"
        class="mt-6"
      />

      <!-- `color`, because `type="warning"` alone paints the text in Vuetify's
           own #fb8c00 - 2.37:1 on the tonal fill it draws behind it. The type
           is left on for the semantics; the icon was already this component's
           own. -->
      <v-alert
        v-if="region && !company"
        type="warning"
        color="ink-warning"
        variant="tonal"
        class="mt-4"
        :icon="mdiCash"
      >
        <div class="d-flex align-center w-100">
          <v-btn
            href="https://zrzutka.pl/rd7ssx/pay"
            target="_blank"
            color="#E64164"
          >
            Zrzutka
            <v-img
              :width="30"
              aspect-ratio="16/9"
              cover
              src="@/assets/zrzutka.png"
            />
          </v-btn>
          <v-spacer />
          <div class="mr-8">
            Wesprzyj projekt na zrzutce, by przygotować podsumowania dla innych
            miast, podobie jak to dla
            <NuxtLink to="/entity/region/teryt1261">Krakowa</NuxtLink>
          </div>
          <v-spacer />
        </div>
      </v-alert>

      <ExploreSelectedCompanies
        :companies="selectedCompaniesData"
        class="mt-4"
      />
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import { mdiCash } from "@mdi/js";
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useListWithStats } from "~/composables/entity/listWithStats";
import { useQueryFilters } from "~/composables/queryFilters";
import { parties } from "~~/shared/misc";
import { regionFilterOptions } from "~~/shared/teryt";
import type { PersonRich } from "~~/shared/model";
import type { Query } from "~~/server/api/nodes/index.get";
import { useCurrentUser } from "vuefire";

import { useEdges } from "~/composables/edges";
import { trackGoal } from "~/composables/analytics";
import { activeTabelaFilters, tabelaFiltersChanged } from "~~/shared/analytics";

definePageMeta({ fullWidth: true, affineLink: "BYOEeL1iG0mvIR3yz2pOs" });
useHead({
  title: "Eksploruj - Tabela - koryta.pl",
  // Marks the page for the `overflow-x` override below. Set through the head
  // rather than a stylesheet because it has to come off again when the reader
  // navigates away - no other page wants a sideways scrollbar.
  htmlAttrs: { class: "tabela-scroll-x" },
});

const route = useRoute();

const DEFAULT_ITEMS_PER_PAGE = 10;

const { setQuery, stringFilter, arrayFilter, choiceFilter, numberFilter } =
  useQueryFilters({ resetOnChange: ["page"] });

// Paging and sorting are the table's own state rather than filters, so they do
// not reset the page - they set it.
//
// The parameters are read once into a ref each rather than inside the getter:
// the setters compare against the current value before counting the change,
// and `numberFilter` builds a fresh computed per call, so reading it there
// would allocate one on every write.
const pageParam = numberFilter("page");
const page = computed<number>({
  get: () => pageParam.value ?? 1,
  set: (val) => {
    // Only a move off the first page, and only one the reader made. Vuetify's
    // table writes the page back on mount and whenever the row count changes,
    // and neither is somebody reaching row 11.
    if (val > 1 && val !== (pageParam.value ?? 1)) {
      trackGoal("tabela:paged", { kind: "page", to: String(val) });
    }
    void setQuery({ page: val > 1 ? String(val) : undefined });
  },
});

const itemsPerPageParam = numberFilter("itemsPerPage");
const itemsPerPage = computed<number>({
  get: () => itemsPerPageParam.value ?? DEFAULT_ITEMS_PER_PAGE,
  set: (val) => {
    // Asking for more rows is the same intent as turning the page, so it is the
    // same goal - what matters is that the reader wanted past the tenth row.
    if (val !== (itemsPerPageParam.value ?? DEFAULT_ITEMS_PER_PAGE)) {
      trackGoal("tabela:paged", { kind: "rows", to: String(val) });
    }
    void setQuery({
      itemsPerPage: val === DEFAULT_ITEMS_PER_PAGE ? undefined : String(val),
      page: undefined,
    });
  },
});

type SortEntry = { key: string; order: "asc" | "desc" };

const sortBy = computed<SortEntry[]>({
  get: (): SortEntry[] => {
    const key = (route.query.sortBy as string | undefined) || undefined;
    if (!key) return [];
    const order: "asc" | "desc" =
      route.query.sortDesc === "true" ? "desc" : "asc";
    return [{ key, order }];
  },
  set: (val: SortEntry[]) => {
    const sort = val[0];
    // Compared against what is already in the url, because the table hands its
    // sort back on mount as well as on a click.
    const current = route.query.sortBy as string | undefined;
    const currentDesc = route.query.sortDesc === "true";
    if (
      sort?.key !== current ||
      (sort ? sort.order === "desc" : false) !== currentDesc
    ) {
      trackGoal("tabela:sorted", {
        by: sort?.key ?? "none",
        order: sort?.order ?? "none",
      });
    }
    void setQuery({
      sortBy: sort?.key,
      sortDesc: sort ? String(sort.order === "desc") : undefined,
      page: undefined,
    });
  },
});

const user = useCurrentUser();

// What is left of the table below 960px: two columns, who the person is and
// what they have done. Everything marked with this - elections, votes, the
// vote control, visibility - is there to steer exploration rather than to read
// a row, and all of it is in the drawer the name opens. The whole set on a
// phone meant scrolling sideways past them to reach anything, at the same
// boundary the drawer and the sticky header already switch on.
//
// It was eight columns until the reporter pointed out that most of them were
// truncated ones: a party ellipsised after six letters and a company after
// eight. Name+partie is one reading and so is firmy+data, so they are one cell
// apiece now (explore/Table.vue); „Lata pracy” and „Notatki” stopped being
// columns altogether, because seven days of api logs put them at under 4% of
// sorted queries between them and they are still reachable from the sort menus
// on the two columns that absorbed them.
//
// A stylesheet rather than `useDisplay().smAndDown` and a shorter array:
// under SSR Vuetify builds its display state from a placeholder width of
// 1280px and only measures the window when the app's suspense resolves, so a
// width-driven header list renders the full desktop table first and corrects
// itself afterwards - and never corrects it at all if that one update does
// not run. `hidden-sm-and-down` is Vuetify's own utility, `display: none`
// under `(max-width: 959.98px)`, and it is right before the first paint.
const PHONE_HIDDEN = {
  headerProps: { class: "hidden-sm-and-down" },
  cellProps: { class: "hidden-sm-and-down" },
};

// Nothing in here depends on who is reading any more, so it is a plain array:
// „Widoczność” was the one entry that did, and it is a badge beside the name
// now (`draft-with-name` above). It was a two-value flag whose common value is
// „opublikowane”, so as a column it spent 142px repeating that word to mark
// the exception by its absence.
//
// The sort behind it is untouched and has to stay that way: `visibility` maps
// onto `stats.isApproved` in server/api/nodes/index.get.ts, `tableSortOptions`
// carries it as „Status” flagged `adminOnly`, and the query bar's sort menu is
// built from that list - so a signed-in reader still orders by it, and an
// incoming `?sortBy=visibility` link still works with no column to click.
const headers = [
  // The pink „otwórz wyszukiwarki” button rides in this cell on a desktop
  // (`search-with-name`); the „Eksploruj” column it came from is gone. Its
  // other half, the magnifier, only opened the drawer - which is what
  // clicking the name has always done.
  { title: "Osoba", key: "name", sortable: true },
  // Keyed on `latestEmploymentStart` rather than on a `firmy` matching the
  // title. The key is emitted verbatim as `?sortBy=` and handed to a
  // Firestore `orderBy` with no allow-list in between
  // (`server/api/nodes/index.get.ts:145`), so a prettier key would empty the
  // table rather than reorder it - and would strand the
  // `?sortBy=latestEmploymentStart` links that /eksploruj/nowe and the QA
  // list already carry. „Lata pracy” is in this column's sort menu. Not
  // phone-hidden: the employers are half of what a row says.
  { title: "Firmy", key: "latestEmploymentStart", sortable: true },
  // `sortable: false` and it has to stay that way: `elections` is not a key
  // the api maps onto a Firestore path, so a click would put it into
  // `orderBy` verbatim and answer with an empty table rather than an error.
  // Below 960px explore/Table.vue folds these chips back into the „Firmy”
  // cell, where they cost no column of their own.
  { title: "Wybory", key: "elections", sortable: false, ...PHONE_HIDDEN },
  // `stats.votes.interesting`, spelled the way the api spells it; the old
  // `votes.interesting` matched no slot at all. „Notatki” is in this
  // column's sort menu. Hidden on a phone, where the number comes back as a
  // line under the name (`score-on-phone`) - at 390px this header sits at
  // x=363 on a 358px viewport, so neither the count nor the sort behind it
  // can be reached.
  {
    title: "Oceny",
    key: "stats.votes.interesting",
    sortable: true,
    align: "center" as const,
    ...PHONE_HIDDEN,
  },
  {
    title: "Twój głos",
    key: "userVote",
    sortable: false,
    align: "center" as const,
    ...PHONE_HIDDEN,
  },
];

// TODO calculate the hidden count
const hiddenCount = computed(() => {
  let stats;
  if (region.value) {
    stats = regions.value?.[region.value[0]]?.stats;
  } else if (company.value) {
    stats = places.value?.[company.value[0]]?.stats;
  }

  if (
    stats?.edges?.all?.targetNodeIds &&
    stats?.edges?.approved?.targetNodeIds
  ) {
    const diff =
      stats.edges.all.targetNodeIds.length -
      stats.edges.approved.targetNodeIds.length;
    return diff > 0 ? diff : 0;
  }
  return 0;
});

// This page's whole template is a <ClientOnly>, so the server renders none of
// it - but these two fetches still ran during SSR and their results were
// serialised into __NUXT_DATA__, which is where most of an ~8 MB response came
// from. Every reader waited on all of it before seeing anything.
const { entities: places } = useEntities("place", {}, { server: false });
// Shared with the drawer and the table rows, which need the region each company
// sits in rather than the region nodes themselves.
const { regions, companyRegions, companyLocations } = useCompanyLocations();

const region = computed<[string, string] | undefined>(() => {
  const terytParam = route.query.teryt as string | undefined;
  if (terytParam) {
    for (const [id, region] of Object.entries(regions.value ?? {})) {
      if (region.teryt === terytParam) {
        return [id, region.name];
      }
    }
  }
  return undefined;
});

const company = computed<[string, string] | undefined>(() => {
  const id = filterPlace.value?.[0];
  const place = id ? places.value?.[id] : undefined;
  return id && place ? [id, place.name] : undefined;
});

const selectedCompaniesData = computed(() => {
  if (!filterPlace.value || !places.value) return [];
  const selected = [];
  for (const id of filterPlace.value) {
    const place = places.value[id];
    if (place) {
      selected.push({ id, ...place, location: companyLocations.value[id] });
    }
  }
  return selected;
});

const filterVisibility = choiceFilter<"all" | "public" | "private">(
  "visibility",
  "all",
);
const filterParty = arrayFilter("party");
const filterTeryt = stringFilter("teryt");
const filterCompanyTeryt = stringFilter("companyTeryt");
const { filterPlace, legacyKrs, availableCompanies } = usePlaceFilter(
  places,
  arrayFilter,
  setQuery,
);
const filterCategory = stringFilter("category");
const filterCurrentlyEmployed = choiceFilter<"all" | "any" | "selected">(
  "currentlyEmployed",
  "all",
);
const filterHideVoted = choiceFilter<"all" | "no_votes" | "has_votes">(
  "hideVoted",
  "all",
);
const filterMinEmploymentDate = stringFilter("minEmploymentDate");
const filterMinVotes = numberFilter("minVotes");

/** Every filter dropped in one write, which is why the bar asks the page to do
 * it rather than doing it itself: each filter above is a writable computed
 * over `route.query`, and each write builds a `router.push` from the query as
 * it is now. `route.query` only changes once the navigation is confirmed, so
 * twelve writes in one tick would all start from the same still-filtered url
 * and the last one would win - eleven filters left standing after a button
 * that promised none. It is also one history entry rather than twelve.
 *
 * `parties` and `krs` are in the list without a control of their own: they are
 * the spellings older links use for `party` and `place`, and a „Wyczyść” that
 * left them behind would clear the chips and none of the filtering. */
/** Set by `clearFilters`, read once by the query watcher below.
 *
 * Only ever armed when the clear will actually change the url, so the watcher
 * it is waiting for is guaranteed to run and take it down again. Armed on a
 * no-op it would swallow the reader's next real filter change. */
let clearInFlight = false;

const clearFilters = () => {
  const dropped = activeTabelaFilters(route.query);
  if (dropped.length > 0) {
    clearInFlight = true;
    trackGoal("tabela:filter-cleared", { dropped: String(dropped.length) });
  }
  void setQuery({
    category: undefined,
    teryt: undefined,
    companyTeryt: undefined,
    party: undefined,
    parties: undefined,
    place: undefined,
    krs: undefined,
    currentlyEmployed: undefined,
    visibility: undefined,
    hideVoted: undefined,
    minEmploymentDate: undefined,
    minVotes: undefined,
    page: undefined,
  });
};

const availableRegions = computed(() =>
  regionFilterOptions(Object.values(regions.value ?? {})),
);

const availableParties = computed(() => {
  return [
    { title: "Brak partii", value: "__NONE__" },
    ...parties.map((p) => ({ title: p, value: p })),
  ];
});

const apiQuery = computed(
  () =>
    ({
      type: "person",
      limit: itemsPerPage.value,
      page: page.value,
      sortBy: sortBy.value[0]?.key,
      sortDesc: sortBy.value[0]
        ? ((sortBy.value[0].order === "desc" ? "true" : "false") as
            "true" | "false")
        : undefined,
      parties:
        filterParty.value && filterParty.value.length > 0
          ? filterParty.value
          : undefined,
      visibility:
        filterVisibility.value !== "all" ? filterVisibility.value : undefined,
      place:
        filterPlace.value && filterPlace.value.length > 0
          ? filterPlace.value
          : undefined,
      // Passed straight through rather than translated, so an old link filters
      // on the first render too, before the place list needed to map it onto
      // node ids has arrived. The api unions the two.
      krs: legacyKrs.value ?? undefined,
      teryt: filterTeryt.value || undefined,
      companyTeryt: filterCompanyTeryt.value || undefined,
      category: filterCategory.value || undefined,
      hideVoted:
        filterHideVoted.value !== "all" ? filterHideVoted.value : undefined,
      currentlyEmployed:
        filterCurrentlyEmployed.value !== "all"
          ? filterCurrentlyEmployed.value
          : undefined,
      minEmploymentDate: filterMinEmploymentDate.value || undefined,
      minVotes: filterMinVotes.value != null ? filterMinVotes.value : undefined,
    }) as Query,
);

// TODO maybe it shouldn't be await?

// We perform a double join in the composible
// We query /api/nodes/uncached and /api/graph/local
// to join the stats info with the node neighborhood.
const { tableItems, totalItems, pending } = await useListWithStats(
  apiQuery,
  "eksploruj-tabela-data",
  { server: false, companyLocations },
);

const openDrawer = shallowRef(false);
const focusedPerson = shallowRef<PersonRich | undefined>(undefined);
const focusedPersonId = computed(() => focusedPerson.value?.id);
const {
  sources: focusedSources,
  targets: focusedTargets,
  refresh: refreshFocusedEdges,
} = await useEdges(focusedPersonId);
const focusedEdges = computed(() => [
  ...focusedSources.value,
  ...focusedTargets.value,
]);

const focusPerson = (item: PersonRich) => {
  // The table's conversion: everything else on the page exists to get a reader
  // to open one of these.
  trackGoal("tabela:row-opened");
  focusedPerson.value = item;
  openDrawer.value = true;
};

// How the reader got here. 73% of the site's entrances land on `/`, and this is
// where the home map, the party treemap and most of the search results send
// them - so whether an arrival carries a filter is the difference between "came
// looking for something" and "was handed the raw list of everybody".
onMounted(() => {
  const arrived = activeTabelaFilters(route.query);
  trackGoal("tabela:open", {
    filtered: arrived.length > 0 ? "true" : "false",
    filters: arrived.join(",") || "none",
  });
});

// Every filter on this page is a writable computed over the query string, so
// the url is the one place that sees all of them - including the close button
// on each chip and the spellings older links still use. Watching it beats
// threading a callback through the filter bar and its eleven controls.
watch(
  () => route.query,
  (after, before) => {
    if (clearInFlight) {
      // „Wyczyść” already reported itself as one event. Without this the same
      // click would also report each of the filters it dropped as used.
      clearInFlight = false;
      return;
    }
    for (const filter of tabelaFiltersChanged(before, after)) {
      trackGoal("tabela:filter", { filter });
    }
  },
);

// Once per settled fetch that came back empty, which is once per filter change
// that found nobody. It does not fire while `pending` is still true, so the
// empty table shown during a load is not counted as a dead end.
watch(pending, (isPending, was) => {
  if (isPending || !was || totalItems.value !== 0) return;
  trackGoal("tabela:no-results", {
    filters: activeTabelaFilters(route.query).join(",") || "none",
  });
});
</script>

<style scoped>
/* The sage band the entity pages put behind a section heading, here behind the
 * column titles - which above 960px stick to the app bar as the reader scrolls
 * and have to stay opaque over the rows passing under them. Sage as a fill,
 * with the titles left in the table's own high-emphasis ink, which measures
 * 13.9:1 on it.
 *
 * Three classes deep because Vuetify's own header background is four elements
 * and three classes (`.v-table.v-table--fixed-header > .v-table__wrapper >
 * table > thead > tr > th`), and a shorter selector loses to it: the scope
 * attribute counts where a class does, not where an element does. */
.table-card :deep(.v-table--fixed-header .v-table__wrapper .v-data-table__th) {
  background: rgb(var(--v-theme-surface-sage));
}

@media (min-width: 960px) {
  /* The header sticks to the app bar rather than to the table, which needs
   * every scroll container between the two out of the way - a `position:
   * sticky` element measures itself against the nearest one. */
  .table-card,
  .table-card :deep(.v-data-table),
  .table-card :deep(.v-table),
  .table-card :deep(.v-table__wrapper) {
    overflow: visible !important;
  }
  .table-card :deep(.v-data-table__th) {
    top: var(--v-layout-top) !important;
  }
}
</style>

<!-- Not scoped: the rule is on <html>, which no component owns. Vuetify sets
     `overflow-x: hidden` there, so the columns that do not fit were clipped
     with no way to reach them - the table sits in a chain of `overflow:
     visible` (see above), so the page is the only thing left that can scroll
     to them. Below 960px the wrapper keeps its own scrollbar and this does not
     apply. -->
<style>
@media (min-width: 960px) {
  html.tabela-scroll-x {
    overflow-x: auto;
  }
}
</style>
