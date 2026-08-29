<template>
  <v-data-table-server
    :items-per-page="itemsPerPage"
    :page="page"
    :sort-by="sortBy"
    fixed-header
    :headers="headers"
    :items="items"
    :items-length="totalItems"
    :loading="pending"
    :items-per-page-text="itemsPerPageText"
    :items-per-page-options="itemsPerPageOptions"
    :no-data-text="noDataText"
    :loading-text="loadingText"
    :hide-default-footer="hideDefaultFooter"
    @update:page="$emit('update:page', $event)"
    @update:items-per-page="$emit('update:itemsPerPage', $event)"
    @update:sort-by="$emit('update:sortBy', $event)"
    @update:options="$emit('update:options', $event)"
  >
    <template #[`header.experience`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Sumaryczna liczba lat przepracowanych w publicznych spółkach"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.latestEmploymentStart`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Firmy, w których osoba pracowała, i wybory, w których startowała. Sortowanie po dacie ostatniego zatrudnienia w publicznej spółce."
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.notesCount`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Liczba notatek stworzonych przez społeczność na temat powiązań tej osoby"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.votes.interesting`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Suma głosów społeczności określających jak interesująca jest ta osoba"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.userVote`]="{ column }">
      <ExploreTableColumnHeader
        :tooltip="userVoteTooltip"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.visibility`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Czy strona osoby jest już opublikowana, czy jest w fazie szkicu (widoczna tylko dla zalogowanych)"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.explore`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Wyświetla panel boczny z większą ilością informacji i opcją interakcji"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <!-- Who the person is: the name and the parties they have stood for, in
         one cell. They were two columns, which on a phone meant two ~60px
         boxes and a party ellipsised after six letters. A wrapping flex row
         gets both readings out of one rule - the chips sit beside a short
         name and drop under a long one - and the column can afford to be wide
         because there are now two of them rather than four. -->
    <template #[`item.name`]="{ item }">
      <div class="name-cell">
        <div class="d-flex flex-wrap align-center ga-1">
          <template v-if="disableFocus">
            <span class="text-primary font-weight-bold">
              {{ item.name }}
            </span>
          </template>
          <template v-else>
            <!-- `text-primary cursor-pointer` on the link is load-bearing:
                 five e2e specs use it as their "the table has loaded"
                 locator. -->
            <NuxtLink
              class="text-primary cursor-pointer"
              @click="$emit('focus', item)"
            >
              {{ item.name }}
            </NuxtLink>
          </template>
          <v-chip
            v-for="party in item.parties"
            :key="party"
            size="small"
            class="party-chip"
          >
            {{ party }}
          </v-chip>
        </div>

        <!-- On a one-person queue the total is what put this person in front
             of the reader, so it stays on the row - as a line under the name,
             which costs nothing, rather than as a column, which costs 32px of
             padding plus its header word. -->
        <div v-if="scoreWithName" class="text-caption text-medium-emphasis">
          Suma ocen: {{ item.stats?.votes?.interesting || 0 }}
        </div>
      </div>
    </template>

    <!-- What the person has done: employers, when the most recent of them
         started, and the elections they stood in. Keyed on
         `latestEmploymentStart` rather than on a fresh `history` key, and that
         is not cosmetic - the header key is what the table emits as `sortBy`
         and `server/api/nodes/index.get.ts` hands an unrecognised one straight
         to a Firestore `orderBy`, which drops every document that lacks the
         field. A new key would empty the table on the first tap of the header
         and break the `?sortBy=latestEmploymentStart` links the QA list and
         /eksploruj/nowe already point at. -->
    <template #[`item.latestEmploymentStart`]="{ item }">
      <div class="history-cell d-flex flex-column flex-md-row ga-1 ga-md-4">
        <div
          v-if="item.companies?.length || item.latestEmploymentStart"
          class="companies-cell"
        >
          <div class="d-flex flex-wrap ga-1 py-1">
            <span v-for="companyName in item.companies" :key="companyName">
              <v-tooltip :text="shortCompanyName(companyName)" location="top">
                <template #activator="{ props: shortCompanyProps }">
                  <v-chip
                    v-bind="shortCompanyProps"
                    size="small"
                    class="mb-1 text-truncate d-flex company-chip"
                    variant="outlined"
                  >
                    {{ shortCompanyName(companyName) }}
                  </v-chip>
                </template>
              </v-tooltip>
            </span>
          </div>
          <!-- The label goes on a phone and the bare date stays. It is the
               only date in the cell, and the two columns left down there have
               no room for eleven characters of prefix. -->
          <div
            v-if="item.latestEmploymentStart"
            class="text-caption text-medium-emphasis"
          >
            <span class="d-none d-md-inline">Ostatnie zatrudnienie: </span
            >{{ item.latestEmploymentStart }}
          </div>
        </div>

        <div v-if="item.elections?.length" class="elections-cell py-1">
          <v-chip
            v-for="(election, i) in item.elections"
            :key="i"
            size="small"
            class="mb-1"
            variant="outlined"
          >
            <v-tooltip activator="parent" location="top" open-delay="200">
              <div v-if="election.location">{{ election.location }}</div>
              <div>
                {{
                  getWojewodztwo(election.teryt)
                    ? `woj. ${getWojewodztwo(election.teryt)}`
                    : "Brak informacji o województwie"
                }}
              </div>
              <div v-if="election.committee">{{ election.committee }}</div>
            </v-tooltip>
            <span v-if="election.year" class="font-weight-bold mr-1">
              {{ election.year }}
            </span>
            <span v-if="election.location" class="election-location">
              {{ election.location }}
            </span>
          </v-chip>
        </div>
      </div>
    </template>

    <template #[`item.visibility`]="{ item }">
      <v-chip
        size="small"
        :color="item.visibility ? 'success' : 'warning'"
        variant="tonal"
      >
        {{ item.visibility ? "Opublikowane" : "Szkic" }}
      </v-chip>
    </template>

    <template #[`item.notesCount`]="{ item }">
      {{ item.stats?.notesCount || 0 }}
    </template>

    <template #[`item.votes.interesting`]="{ item }">
      {{ item.stats?.votes?.interesting || 0 }}
    </template>

    <template #[`item.userVote`]="{ item }">
      <ButtonVoteNumber
        :id="item.id"
        category="interesting"
        @voted="$emit('action:voted', item)"
      />
    </template>

    <template #[`item.explore`]="{ item }">
      <div class="d-flex flex-nowrap">
        <v-tooltip :text="SEARCH_ALL_TOOLTIP" open-delay="2000" location="top">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              :icon="mdiOpenInNew"
              variant="text"
              color="secondary"
              @click.stop="
                executeSearchAll(item, region, company);
                $emit('action:explored', item);
                if (!disableFocus) $emit('focus', item);
              "
            />
          </template>
        </v-tooltip>
        <v-btn
          v-if="!disableFocus"
          :icon="mdiMagnify"
          variant="text"
          color="primary"
          @click.stop="$emit('focus', item)"
        />
      </div>
    </template>
  </v-data-table-server>
</template>

<script setup lang="ts">
import { mdiMagnify, mdiOpenInNew } from "@mdi/js";
import {
  SEARCH_ALL_TOOLTIP,
  executeSearchAll,
} from "~/composables/usePersonSearch";
import { voteScaleSummary } from "~/composables/votes";
import type { PersonRich } from "~~/shared/model";

const userVoteTooltip = [
  "Twój osobisty głos dla tej osoby (widoczny tylko dla Ciebie).",
  voteScaleSummary("interesting"),
]
  .filter(Boolean)
  .join(" ");

withDefaults(
  defineProps<{
    items: PersonRich[];
    totalItems: number;
    pending: boolean;
    page?: number;
    itemsPerPage?: number;
    sortBy?: { key: string; order: "asc" | "desc" }[];
    headers: Record<string, unknown>[];
    noDataText?: string;
    itemsPerPageText?: string;
    itemsPerPageOptions?: { value: number; title: string }[];
    loadingText?: string;
    hideDefaultFooter?: boolean;
    region?: [string, string];
    company?: [string, string];
    disableFocus?: boolean;
    /** Print the aggregate score under the name instead of expecting a
     * `stats.votes.interesting` column.
     *
     * A per-page flag on the shared component, like `disableFocus` above,
     * because the name cell lives here and there is no pass-through slot for
     * it. /eksploruj/nowe shows one person at a time and had to drop columns
     * to fit its card, but the total is the number its queue is ordered by -
     * so it moves rather than going away. Off everywhere else, so
     * /eksploruj/tabela - which still declares the column - draws no extra
     * line. */
    scoreWithName?: boolean;
  }>(),
  {
    page: 1,
    itemsPerPage: 10,
    sortBy: () => [],
    noDataText: "Brak danych",
    itemsPerPageText: "Wierszy na stronę:",
    // Vuetify's defaults, except that the last one is labelled by its English
    // locale string ("All") - the app never sets a Polish locale.
    itemsPerPageOptions: () => [
      { value: 10, title: "10" },
      { value: 25, title: "25" },
      { value: 50, title: "50" },
      { value: 100, title: "100" },
      { value: -1, title: "Wszystkie" },
    ],
    loadingText: "Ładowanie...",
    hideDefaultFooter: false,
    disableFocus: false,
    scoreWithName: false,
    region: undefined,
    company: undefined,
  },
);

defineEmits<{
  (e: "update:page" | "update:itemsPerPage", val: number): void;
  (e: "update:sortBy", val: { key: string; order: "asc" | "desc" }[]): void;
  (
    e: "update:options",
    val: {
      sortBy: { key: string; order: string }[];
      page: number;
      itemsPerPage: number;
    },
  ): void;
  (e: "action:explored" | "action:voted" | "focus", item: PersonRich): void;
}>();

const shortCompanyName = (companyName: string | undefined) => {
  if (!companyName) return "";
  const spolkaIndex = companyName.indexOf(
    "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  );
  if (spolkaIndex !== -1) {
    companyName =
      companyName.slice(0, spolkaIndex) + companyName.slice(spolkaIndex + 39);
  }
  return companyName;
};

const terytToWojewodztwo: Record<string, string> = {
  "02": "dolnośląskie",
  "04": "kujawsko-pomorskie",
  "06": "lubelskie",
  "08": "lubuskie",
  "10": "łódzkie",
  "12": "małopolskie",
  "14": "mazowieckie",
  "16": "opolskie",
  "18": "podkarpackie",
  "20": "podlaskie",
  "22": "pomorskie",
  "24": "śląskie",
  "26": "świętokrzyskie",
  "28": "warmińsko-mazurskie",
  "30": "wielkopolskie",
  "32": "zachodniopomorskie",
};

const getWojewodztwo = (teryt?: string) => {
  if (!teryt || teryt.length < 2) return undefined;
  return terytToWojewodztwo[teryt.substring(0, 2)];
};
</script>

<style scoped>
/* Committee names run to "KOMITET WYBORCZY WYBORCÓW ..." and used to sit in
 * the chip, which made this the widest column on the page by a distance. It is
 * in the tooltip now, and what is left is capped so a long town name cannot do
 * the same thing again. */
.elections-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  max-width: 220px;
}

/* The name, the party chips and (on /eksploruj/nowe) the score share this now,
 * so it can be wider than the 150px the name alone had - the column it sits in
 * is one of two rather than one of four, and the room came out of the two that
 * went. Still called `name-cell` rather than something honest like
 * `person-cell` because `tests/e2e/remove_edge.spec.ts` clicks the drawer open
 * through it. */
.name-cell {
  max-width: 200px;
}

.companies-cell {
  max-width: 300px;
}

/* Matches the cell, in pixels rather than a percentage: the chip sits in an
 * auto sized flex item, so there is nothing definite for a percentage to
 * resolve against. */
.company-chip {
  max-width: 300px;
}

/* Above the breakpoint the two halves of the history sit side by side and
 * each keeps the cap it had as a column of its own; below it they stack, which
 * is what `flex-column flex-md-row` on the cell does. No cap here on purpose -
 * the children carry theirs, and a cap on the parent would fight the gap. */
.history-cell {
  align-items: flex-start;
}

/* The page drops to two columns here (see pages/eksploruj/tabela.vue), and a
 * 375px phone leaves the table 343px to put them in: 311px of content once the
 * reduced 8px padding on four cell edges is out. A chip cannot wrap, so
 * whatever it is allowed to be wide is what its column costs at a minimum, and
 * these caps are that budget split 120/185 - they are what keeps the page off
 * a sideways scroll. It is a far kinder split than the 100/60/72/72 four
 * columns forced, which ellipsised a party after six letters. A name or a
 * company longer than its share is still truncated rather than setting the
 * width of the column for every other row - the drawer behind the name has all
 * of it in full. */
@media (max-width: 959.98px) {
  .name-cell,
  .party-chip {
    max-width: 120px;
    /* A surname long enough to not fit is broken across lines rather than
     * pushing the history column out. */
    overflow-wrap: anywhere;
  }

  .history-cell,
  .companies-cell,
  .company-chip,
  .elections-cell {
    max-width: 185px;
  }

  /* Vuetify's 16px each side, twice over, is 64px of those 343px. Halving it
   * buys 32px back, which is a whole party chip. */
  :deep(.v-data-table__td),
  :deep(.v-data-table__th) {
    padding-inline: 8px !important;
  }
}

.elections-cell .v-chip {
  max-width: 100%;
}

.elections-cell :deep(.v-chip__content) {
  min-width: 0;
}

.party-chip :deep(.v-chip__content) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

.election-location {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
