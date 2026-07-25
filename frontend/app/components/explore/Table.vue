<template>
  <v-data-table-server
    :items-per-page="itemsPerPage"
    :page="page"
    :sort-by="sortBy"
    fixed-header
    mobile-breakpoint="sm"
    :headers="headers"
    :items="items"
    :items-length="totalItems"
    :loading="pending"
    :items-per-page-text="itemsPerPageText"
    :no-data-text="noDataText"
    :loading-text="loadingText"
    :hide-default-footer="hideDefaultFooter"
    @update:page="$emit('update:page', $event)"
    @update:items-per-page="$emit('update:itemsPerPage', $event)"
    @update:sort-by="$emit('update:sortBy', $event)"
    @update:options="$emit('update:options', $event)"
  >
    <!-- Vuetify's stacked mobile row prints "label: value" for every column,
         which buries the name and leaves a blank line per empty field. On a
         phone a person reads much better as a small card. -->
    <template v-if="mobile" #item="{ item }">
      <tr class="person-card-row">
        <td colspan="99" class="pa-0">
          <div class="person-card">
            <div class="d-flex align-start ga-2">
              <NuxtLink
                v-if="!disableFocus"
                class="text-primary font-weight-bold text-body-1 cursor-pointer flex-grow-1"
                @click="$emit('focus', item)"
              >
                {{ item.name }}
              </NuxtLink>
              <span v-else class="text-primary font-weight-bold text-body-1">
                {{ item.name }}
              </span>

              <v-chip
                v-if="item.visibility === false"
                size="x-small"
                color="warning"
                variant="tonal"
              >
                Szkic
              </v-chip>
            </div>

            <div
              v-if="item.parties?.length || item.companies?.length"
              class="d-flex flex-wrap ga-1 mt-2"
            >
              <v-chip v-for="party in item.parties" :key="party" size="x-small">
                {{ party }}
              </v-chip>
              <v-chip
                v-for="companyName in item.companies"
                :key="companyName"
                size="x-small"
                variant="outlined"
              >
                {{ shortCompanyName(companyName) }}
              </v-chip>
            </div>

            <div class="d-flex align-center ga-1 mt-2">
              <span class="text-caption text-medium-emphasis">
                {{ item.stats?.votes?.interesting || 0 }} gł. ·
                {{ item.stats?.notesCount || 0 }} not.
              </span>
              <v-spacer />
              <ButtonVoteNumber
                :id="item.id"
                category="interesting"
                @voted="$emit('action:voted', item)"
              />
              <v-btn
                :icon="mdiOpenInNew"
                variant="text"
                density="comfortable"
                color="secondary"
                @click.stop="
                  executeSearchAll(item, region, company);
                  $emit('action:explored', item);
                  if (!disableFocus) $emit('focus', item);
                "
              />
              <v-btn
                v-if="!disableFocus"
                :icon="mdiMagnify"
                variant="text"
                density="comfortable"
                color="primary"
                @click.stop="$emit('focus', item)"
              />
            </div>
          </div>
        </td>
      </tr>
    </template>

    <template #[`header.experience`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Sumaryczna liczba lat przepracowanych w publicznych spółkach"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.latestEmploymentStart`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Najnowsza data rozpoczęcia zatrudnienia w dostępnych powiązaniach"
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
        tooltip="Twój osobisty głos dla tej osoby (widoczny tylko dla Ciebie)"
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
      <div class="cell-name">
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
      <div class="d-flex flex-wrap gap-1 py-1 cell-companies">
        <span v-for="companyName in item.companies" :key="companyName">
          <v-tooltip :text="shortCompanyName(companyName)" location="top">
            <template #activator="{ props: shortCompanyProps }">
              <v-chip
                v-bind="shortCompanyProps"
                size="small"
                class="mr-1 mb-1 text-truncate d-flex cell-companies__chip"
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
      <template v-for="(election, i) in item.elections" :key="i">
        <v-chip size="small" class="mr-1 mb-1" variant="outlined">
          <v-tooltip activator="parent" location="top" open-delay="200">
            {{
              getWojewodztwo(election.teryt)
                ? `woj. ${getWojewodztwo(election.teryt)}`
                : "Brak informacji o województwie"
            }}
          </v-tooltip>
          <template v-if="election.year">
            <span class="font-weight-bold mr-1">{{ election.year }}</span>
          </template>
          <template v-if="election.location">
            {{ election.location }}
          </template>
          <template v-if="election.committee">
            <span class="text-caption ml-1">({{ election.committee }})</span>
          </template>
        </v-chip>
        <br v-if="i < item.elections.length - 1" />
      </template>
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
import { useDisplay } from "vuetify";
import { executeSearchAll } from "~/composables/usePersonSearch";
import type { PersonRich } from "~~/shared/model";

const { smAndDown: mobile } = useDisplay();

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
/* Cell widths used to be fixed pixel values, which forced the phone layout to
   be at least that wide. Cap them relative to the cell instead. */
.cell-name {
  max-width: 150px;
}

.cell-companies,
.cell-companies__chip {
  max-width: 300px;
}

.person-card {
  padding: 12px 16px;
}

.person-card-row + .person-card-row .person-card {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
