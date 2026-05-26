<template>
  <ClientOnly>
    <div class="align-self-center">
      <h1 class="text-h4 mb-4">Eksploruj nowe osoby</h1>

      <v-alert
        v-if="!showInstructions"
        class="mb-4 cursor-pointer"
        variant="tonal"
        icon="mdi-information"
        @click="showInstructions = true"
      >
        <div class="text-subtitle-1 font-weight-bold">Pokaż instrukcje</div>
      </v-alert>

      <v-alert
        v-model="showInstructions"
        closable
        type="info"
        variant="tonal"
        class="mb-4"
        icon="mdi-information"
      >
        <div class="text-subtitle-1 font-weight-bold">Instrukcje:</div>
        <ul class="pl-0 mt-2" style="list-style: none;">
          <li class="d-flex align-center mb-2" :class="{ 'text-decoration-line-through text-medium-emphasis': actionExplored }">
            <v-icon :color="actionExplored ? 'success' : 'medium-emphasis'" class="mr-2">
              {{ actionExplored ? 'mdi-checkbox-marked-circle' : 'mdi-checkbox-blank-circle-outline' }}
            </v-icon>
            <span>
              Kliknij ikonkę "Eksploruj" w tabeli poniżej aby otworzyć odnośniki wyszukiwania do powiązanych z daną osobą informacji (wyłącz blokowanie wyskakujących okien).
            </span>
          </li>
          <li class="d-flex align-center mb-2">
            <v-icon color="medium-emphasis" class="mr-2">mdi-circle-small</v-icon>
            <span>Spróbuj znaleźć interesujące i istotne informacje na temat tej osoby.</span>
          </li>
          <li class="d-flex align-center mb-2" :class="{ 'text-decoration-line-through text-medium-emphasis': actionNoted }">
            <v-icon :color="actionNoted ? 'success' : 'medium-emphasis'" class="mr-2">
              {{ actionNoted ? 'mdi-checkbox-marked-circle' : 'mdi-checkbox-blank-circle-outline' }}
            </v-icon>
            <span>Dodaj znalezione informacje jako notatki w edytorze poniżej (jeśli są tego warte).</span>
          </li>
          <li class="d-flex align-center mb-2" :class="{ 'text-decoration-line-through text-medium-emphasis': actionVoted }">
            <v-icon :color="actionVoted ? 'success' : 'medium-emphasis'" class="mr-2">
              {{ actionVoted ? 'mdi-checkbox-marked-circle' : 'mdi-checkbox-blank-circle-outline' }}
            </v-icon>
            <span>Na koniec, oddaj swój głos w tabeli w zależności od tego, czy ta osoba jest według Ciebie interesująca czy nie.</span>
          </li>
          <li class="d-flex align-center">
            <v-icon color="medium-emphasis" class="mr-2">mdi-circle-small</v-icon>
            <span>Kiedy skończysz, kliknij przycisk "Następna osoba" aby przejść dalej.</span>
          </li>
        </ul>
      </v-alert>

      <v-card class="table-card mb-4">
        <v-data-table-server
          :items-per-page="1"
          :page="page"
          fixed-header
          :headers="headers"
          :items="tableItems"
          :items-length="totalItems"
          :loading="pending"
          no-data-text="Brak danych do wyświetlenia. Prawdopodobnie przejrzałeś wszystkie nowe powiązania."
          loading-text="Ładowanie..."
          hide-default-footer
        >
          <template #[`header.experience`]="{ column }">
            <ExploreTableColumnHeader
              tooltip="Sumaryczna liczba lat przepracowanych w publicznych spółkach"
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
            <div style="max-width: 150px">
              <span class="text-primary font-weight-bold">
                {{ item.name }}
              </span>
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
            <div class="d-flex flex-wrap gap-1 py-1" style="max-width: 300px">
              <span v-for="companyName in item.companies" :key="companyName">
                <v-tooltip :text="shortCompanyName(companyName)" location="top">
                  <template #activator="{ props }">
                    <v-chip
                      v-bind="props"
                      size="small"
                      class="mr-1 mb-1 text-truncate d-flex"
                      variant="outlined"
                      style="max-width: 300px"
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
                  <span class="text-caption ml-1"
                    >({{ election.committee }})</span
                  >
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
            <ButtonVoteNumber :id="item.id" category="interesting" @voted="actionVoted = true" />
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
                    icon="mdi-open-in-new"
                    variant="text"
                    color="secondary"
                    @click.stop="
                      executeSearchAll(item, undefined, undefined);
                      actionExplored = true;
                    "
                  />
                </template>
              </v-tooltip>
            </div>
          </template>
        </v-data-table-server>
      </v-card>

      <div class="d-flex justify-center mb-8 ga-3">
        <v-btn
          color="primary"
          size="large"
          prepend-icon="mdi-check-all"
          :loading="pending"
          @click="page += Math.round(Math.random() * 5)"
        >
          Następna osoba
        </v-btn>
        <v-btn
          color="secondary"
          size="large"
          prepend-icon="mdi-table"
          to="/eksploruj/tabela?visibility=private&hideVoted=no_votes&sortBy=votes.interesting&sortDesc=true"
        >
          Przeglądaj w tabeli
        </v-btn>
        <v-btn
          color="blue"
          size="large"
          prepend-icon="mdi-chart-line"
          to="/eksploruj/statystyki"
        >
          Zobacz statystyki
        </v-btn>
      </div>

      <template v-if="focusedPerson">
        <v-row>
          <v-col cols="12" md="6">
            <v-card class="mb-4">
              <CardExplorePerson
                :key="focusedPerson.id"
                :person="focusedPerson"
                :region="undefined"
                :company="undefined"
              />
            </v-card>
          </v-col>

          <v-col cols="12" md="6">
            <NoteEditor
              :key="focusedPerson.id"
              :node-id="focusedPerson.id"
              single-column
              @saved="actionNoted = true"
            />
          </v-col>
        </v-row>

        <v-card class="mb-4 pa-4">
          <h2 class="text-h6 mb-4">Historia Zatrudnienia</h2>
          <CardEmploymentHistory :edges="focusedEdges" />
        </v-card>
      </template>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useListWithStats } from "~/composables/entity/listWithStats";
import type { PersonRich } from "~~/shared/model";
import type { Query } from "~~/server/api/nodes/index.get";
import { useCurrentUser } from "vuefire";
import { executeSearchAll } from "~/composables/usePersonSearch";
import { useEdges } from "~/composables/edges";

definePageMeta({
  affineLink: "BYOEeL1iG0mvIR3yz2pOs",
  middleware: "auth",
  maxWidth: 1300,
});
useHead({
  title: "Eksploruj Nowe - koryta.pl",
});

const page = ref(1);
const showInstructions = useCookie<boolean>("show-explore-new-instructions", {
  default: () => true,
});
const user = useCurrentUser();

const actionExplored = ref(false);
const actionNoted = ref(false);
const actionVoted = ref(false);

watch(page, () => {
  actionExplored.value = false;
  actionNoted.value = false;
  actionVoted.value = false;
});

const sortBy = ref([{ key: "votes.interesting", order: "desc" as const }]);

const headers = computed(() => {
  const baseHeaders = [
    { title: "Imię i nazwisko", key: "name", sortable: false },
    { title: "Partie", key: "parties", sortable: false },
    { title: "Firmy", key: "companies", sortable: false },
    { title: "Wybory", key: "elections", sortable: false },
    { title: "Lata pracy", key: "experience", sortable: false },
    { title: "Notatki", key: "notesCount", sortable: false },
    { title: "Głosy łącznie", key: "votes.interesting", sortable: false },
    { title: "Twój głos", key: "userVote", sortable: false },
  ];
  if (user.value) {
    baseHeaders.push({
      title: "Widoczność",
      key: "visibility",
      sortable: false,
    });
  }
  baseHeaders.push({ title: "Eksploruj", key: "explore", sortable: false });
  return baseHeaders;
});

const apiQuery = computed(
  () =>
    ({
      type: "person",
      limit: 1,
      page: page.value,
      sortBy: "votes.interesting",
      sortDesc: "true",
      visibility: "private",
      hideVoted: "no_votes",
    }) as Query,
);

const { tableItems, totalItems, pending } = await useListWithStats(
  apiQuery,
  "nowe-data",
);

const focusedPerson = computed<PersonRich | undefined>(
  () => tableItems.value?.[0],
);
const focusedPersonId = computed(() => focusedPerson.value?.id);
const { sources: focusedSources, targets: focusedTargets } =
  await useEdges(focusedPersonId);
const focusedEdges = computed(() => [
  ...(focusedSources.value || []),
  ...(focusedTargets.value || []),
]);

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
@media (min-width: 960px) {
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
