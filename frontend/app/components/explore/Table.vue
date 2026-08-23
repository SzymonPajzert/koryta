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
        tooltip="Najnowsza data rozpoczęcia zatrudnienia w publicznej spółce"
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

    <template #[`item.name`]="{ item }">
      <div class="name-cell">
        <template v-if="disableFocus">
          <span class="text-primary font-weight-bold">
            {{ item.name }}
          </span>
        </template>
        <template v-else>
          <NuxtLink
            class="text-primary cursor-pointer"
            @click="$emit('focus', item)"
          >
            {{ item.name }}
          </NuxtLink>
        </template>
      </div>
    </template>

    <template #[`item.parties`]="{ item }">
      <v-chip
        v-for="party in item.parties"
        :key="party"
        size="small"
        class="mr-1"
      >
        {{ party }}
      </v-chip>
    </template>

    <template #[`item.companies`]="{ item }">
      <div class="d-flex flex-wrap gap-1 py-1 companies-cell">
        <span v-for="companyName in item.companies" :key="companyName">
          <v-tooltip :text="shortCompanyName(companyName)" location="top">
            <template #activator="{ props: shortCompanyProps }">
              <v-chip
                v-bind="shortCompanyProps"
                size="small"
                class="mr-1 mb-1 text-truncate d-flex company-chip"
                variant="outlined"
              >
                {{ shortCompanyName(companyName) }}
              </v-chip>
            </template>
          </v-tooltip>
        </span>
      </div>
    </template>

    <template #[`item.elections`]="{ item }">
      <div class="elections-cell py-1">
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
        <v-tooltip
          text="Otwiera wiele kart wyszukiwania jednocześnie. Upewnij się, że blokowanie okienek (pop-up) jest wyłączone."
          open-delay="2000"
          location="top"
        >
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
import { executeSearchAll } from "~/composables/usePersonSearch";
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

.name-cell {
  max-width: 150px;
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

/* The page drops to three columns here (see pages/eksploruj/tabela.vue), and
 * the desktop caps alone still add up to more than a phone is wide. These are
 * what make the three of them fit without a sideways scroll. */
@media (max-width: 959.98px) {
  .name-cell {
    max-width: 110px;
  }

  .companies-cell,
  .company-chip {
    max-width: 130px;
  }

  .elections-cell {
    max-width: 120px;
  }
}

.elections-cell .v-chip {
  max-width: 100%;
}

.elections-cell :deep(.v-chip__content) {
  min-width: 0;
}

.election-location {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
