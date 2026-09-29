<template>
  <!-- `v-data-table-server` although every row is already in the browser: the
       page filters, orders and pages them itself (app/utils/companyRows.ts),
       so this draws exactly one page of them - the same component, footer and
       events as the people table beside it, and the same url parameters
       behind both. `must-sort`, because the view always has an order: without
       it, a click on „Osoby” while it is sorted most-first - which it is when
       the url names no order - would ask for no order at all, get that same
       default back, and look like a click that did nothing. -->
  <v-data-table-server
    :items-per-page="itemsPerPage"
    :page="page"
    :sort-by="sortBy"
    must-sort
    fixed-header
    :headers="headers"
    :items="items"
    :items-length="totalItems"
    :loading="pending"
    items-per-page-text="Wierszy na stronę:"
    :items-per-page-options="ITEMS_PER_PAGE_OPTIONS"
    no-data-text="Żadna spółka nie pasuje do tych filtrów."
    loading-text="Ładowanie..."
    data-testid="company-table"
    @update:page="$emit('update:page', $event)"
    @update:items-per-page="$emit('update:itemsPerPage', $event)"
    @update:sort-by="$emit('update:sortBy', $event)"
  >
    <template #[`header.name`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Nazwa instytucji, tak jak zapisał ją rejestr. Kliknij, żeby otworzyć jej stronę - z zarządem, radą nadzorczą i tym, kto kogo zastąpił."
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.categories`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Branża, do której zaliczamy instytucję - zwykle według głównej działalności wpisanej w KRS. Kliknij branżę, żeby zostały tylko instytucje z niej."
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.seat`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Gdzie instytucja ma siedzibę według KRS - zwykle powiat."
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.people`]="{ column }">
      <ExploreTableColumnHeader
        :tooltip="PEOPLE_TOOLTIP"
        :column="column"
        :sort-by="sortBy"
        :sort-options="PEOPLE_SORT_OPTIONS"
        @sort="sortOn"
      />
    </template>

    <!-- What the institution is: its name, which is the way to its page, and
         what is known about who owns it. On a phone the seat comes along too,
         as a line under the name - its column is one of the two that go. -->
    <template #[`item.name`]="{ item }">
      <div class="company-cell py-1">
        <div class="d-flex flex-wrap align-center ga-1">
          <!-- A real link, unlike a person's name in the people table, which
               opens the drawer: an institution has no drawer, and everything
               the reader would want from one - the board now, who came before
               them - is on its page. -->
          <NuxtLink
            :to="companyUrl(item)"
            class="company-name font-weight-bold"
          >
            {{ item.name }}
          </NuxtLink>
          <!-- The people table's badge for a draft, for the same reader: only a
               signed-in one is ever handed an unpublished institution. -->
          <v-chip
            v-if="draftWithName && item.visibility === false"
            size="x-small"
            variant="flat"
            class="bg-surface-warning font-weight-medium"
          >
            szkic
          </v-chip>
        </div>
        <!-- Nothing at all where ownership is unknown, which is most of what
             the register cannot see into: `ChipPublicCompany` without
             `show-unknown` stays silent rather than printing „Właściciel
             nieustalony” down half the rows. -->
        <ChipPublicCompany :company="asCompany(item)" class="mt-1" />
        <div
          v-if="item.seat?.name"
          class="d-md-none text-caption text-ink-neutral mt-1"
        >
          {{ item.seat.name }}
        </div>
      </div>
    </template>

    <!-- The sectors, each one a way to narrow the list to it. Not links to
         `categoryFilterUrl` the way the chips on an institution's page are:
         that address opens the people table, and a reader who clicks „Koleje”
         on a row of companies wants the other railways listed where they
         are. -->
    <template #[`item.categories`]="{ item }">
      <div class="d-flex flex-wrap ga-1 py-1">
        <v-chip
          v-for="value in item.categories"
          :key="value"
          size="x-small"
          variant="tonal"
          :prepend-icon="mdiTagOutline"
          :title="`Pokaż tylko: ${categoryTitle(value)}`"
          @click="$emit('category', value)"
        >
          {{ categoryTitle(value) }}
        </v-chip>
      </div>
    </template>

    <template #[`item.seat`]="{ item }">
      <span v-if="item.seat?.name">{{ item.seat.name }}</span>
      <span v-else class="text-ink-neutral">—</span>
    </template>

    <!-- The count, how many of them are there now, and when the newest of
         their posts began - the three things that say whether an institution
         is worth opening. A dash rather than „0 osób” for one nobody on the
         site is tied to: most rows of a sector are that, and a column of zeros
         reads as a column of findings. -->
    <template #[`item.people`]="{ item }">
      <!-- Said outright when the counts did not arrive, rather than drawn as
           the dash below: that dash means „nobody”, which would be the one
           thing this column must never claim without knowing. -->
      <span v-if="countsUnavailable" class="text-caption text-ink-neutral">
        brak danych
      </span>
      <div v-else-if="item.people > 0" class="people-cell py-1">
        <div class="font-weight-bold">
          {{ polishCounting(item.people, "osoba", "osoby", "osób") }}
        </div>
        <div v-if="item.current > 0" class="text-caption text-ink-neutral">
          w tym {{ item.current }} obecnie
        </div>
        <span
          v-if="item.latestStart"
          class="meta-pill bg-surface-sage text-caption mt-1"
          :title="latestStartTitle(item)"
        >
          <v-icon :icon="mdiCalendarBlankOutline" size="13" />
          <span class="d-none d-md-inline">Najnowsze zatrudnienie</span>
          od {{ monthYear(item.latestStart) || item.latestStart }}
        </span>
      </div>
      <span v-else class="text-ink-neutral">—</span>
    </template>
  </v-data-table-server>
</template>

<script setup lang="ts">
import { mdiCalendarBlankOutline, mdiTagOutline } from "@mdi/js";
import { generateEntityUrl } from "~/composables/slugs";
import { polishCounting } from "~/composables/polish";
import type { CompanyRow } from "~/utils/companyRows";
import { categoryTitle } from "~~/shared/companyCategories";
import { longDate, monthYear } from "~~/shared/dates";
import type { Company } from "~~/shared/model";
import { companySortOptions } from "~~/shared/queryUrl";

type SortEntry = { key: string; order: "asc" | "desc" };

const props = withDefaults(
  defineProps<{
    /** One page of rows, already filtered and ordered by the page. */
    items: CompanyRow[];
    /** Rows the filters leave, across every page. */
    totalItems: number;
    pending: boolean;
    page?: number;
    itemsPerPage?: number;
    /** The order in force, the default included - never empty, see
     * `must-sort` above. */
    sortBy: SortEntry[];
    /** Mark an unpublished institution with „szkic”, for a signed-in
     * reader. */
    draftWithName?: boolean;
    /** /api/stats/companies failed, so no row's count is known. */
    countsUnavailable?: boolean;
  }>(),
  {
    page: 1,
    itemsPerPage: 10,
    draftWithName: false,
    countsUnavailable: false,
  },
);

const emit = defineEmits<{
  (e: "update:page" | "update:itemsPerPage", value: number): void;
  (e: "update:sortBy", value: SortEntry[]): void;
  /** A sector chip was clicked: narrow the list to that sector. */
  (e: "category", value: string): void;
}>();

/** The people table's page sizes, for the same reason: Vuetify's „Wszystkie”
 * would be every institution in the database drawn at once. */
const ITEMS_PER_PAGE_OPTIONS = [
  { value: 10, title: "10" },
  { value: 25, title: "25" },
  { value: 50, title: "50" },
  { value: 100, title: "100" },
];

/** Below 960px what is left is who the institution is and how many people it
 * has had: the sector is what the reader filtered by, and the seat moves under
 * the name. A stylesheet class rather than a width-driven header list, for the
 * reason pages/eksploruj/tabela.vue gives: under SSR Vuetify measures a
 * placeholder 1280px window first. */
const PHONE_HIDDEN = {
  headerProps: { class: "hidden-sm-and-down" },
  cellProps: { class: "hidden-sm-and-down" },
};

const headers = [
  { title: "Spółka", key: "name", sortable: true },
  { title: "Branża", key: "categories", sortable: false, ...PHONE_HIDDEN },
  { title: "Siedziba", key: "seat", sortable: false, ...PHONE_HIDDEN },
  { title: "Osoby", key: "people", sortable: true },
];

/** What the count is, where it stops, and how old it can be: the counts come
 * from a response cached for six hours (server/api/stats/companies.get.ts),
 * so a person published this morning can be missing from them until the
 * afternoon. */
const PEOPLE_TOOLTIP = [
  "Osoby z opublikowaną stroną na koryta.pl, które zasiadają lub zasiadały w tej instytucji - w zarządzie, w radzie albo na innym stanowisku.",
  "Tylko ta instytucja, bez jej spółek zależnych.",
  "Liczby odświeżają się co kilka godzin.",
  "W menu kolumny można sortować także po liczbie obecnie zatrudnionych i po dacie najnowszego zatrudnienia.",
].join(" ");

/** The three orders the „Osoby” column stands for, in its menu. */
const PEOPLE_SORT_OPTIONS = companySortOptions
  .filter((option) => option.key !== "name")
  .map(({ key, sentence, short }) => ({ key, sentence, short }));

/** A pick from the column's menu. Descending first, like the people table's
 * menus: the most people, the most of them there now and the newest
 * employment are all at the top end. Picking the order already in force flips
 * it. */
function sortOn(key: string) {
  const current = props.sortBy[0];
  const order =
    current?.key === key && current.order === "desc" ? "asc" : "desc";
  emit("update:sortBy", [{ key, order }]);
}

function companyUrl(row: CompanyRow) {
  return generateEntityUrl("place", row.id, row.name);
}

/** What `ChipPublicCompany` reads - the ownership flags - in the shape it
 * takes. It asks for a whole company so that any caller can hand one over, and
 * reads nothing else off it. */
function asCompany(row: CompanyRow): Company {
  return {
    type: "place",
    name: row.name,
    isPublic: row.isPublic,
    isPublicSource: row.isPublicSource,
  } as Company;
}

/** The day behind the month the pill prints, for whoever wants to check it
 * against the register. */
function latestStartTitle(row: CompanyRow) {
  const exact = row.latestStart ? longDate(row.latestStart, "") : "";
  return exact
    ? `Najnowsze zatrudnienie w tej instytucji zaczęło się ${exact}`
    : "Najnowsze zatrudnienie w tej instytucji";
}
</script>

<style scoped>
/* The name in the people table's ink: sage is a fill colour, 1.85:1 as text
 * on white, and `ink.sage` is the same hue at 6.43:1. */
.company-name {
  color: rgb(var(--v-theme-ink-sage));
  text-decoration: none;
}

.company-name:hover,
.company-name:focus-visible {
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* Long enough to wrap - a register name runs to „WOJEWÓDZKIE CENTRUM
 * SZPITALNE KOTLINY JELENIOGÓRSKIEJ (Jelenia Góra)” - and capped so one of
 * those does not take the width the other columns need. */
.company-cell {
  max-width: 420px;
}

/* The people table's meta pill (explore/Table.vue), at the same size. */
.meta-pill {
  align-items: center;
  border-radius: 6px;
  display: inline-flex;
  flex-wrap: wrap;
  font-weight: 600;
  gap: 4px;
  padding: 1px 6px;
  white-space: nowrap;
}

:deep(tbody .v-data-table__tr:hover > .v-data-table__td) {
  background-color: rgba(var(--v-theme-primary), 0.08);
}

/* Two columns on a 375px phone, as in the people table: 343px for the table,
 * split between the name and the count. */
@media (max-width: 959.98px) {
  .company-cell {
    max-width: 200px;
    overflow-wrap: anywhere;
  }

  :deep(.v-data-table__td),
  :deep(.v-data-table__th) {
    padding-inline: 8px !important;
  }
}
</style>
