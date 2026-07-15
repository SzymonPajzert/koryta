<template>
  <ClientOnly>
    <div class="align-self-center">
      <h1 class="text-h4 mb-4">Eksploruj nowe osoby</h1>

      <!-- CLOSED STATE -->
      <div v-if="!showInstructions" class="d-flex align-center ga-3 mb-4">
        <v-alert
          class="flex-grow-1 cursor-pointer mb-0"
          :color="allActionsDone ? 'success' : undefined"
          variant="tonal"
          :icon="mdiInformation"
          @click="showInstructions = true"
        >
          <div class="text-subtitle-1 font-weight-bold">
            {{
              allActionsDone
                ? "Wszystkie akcje wykonane - gotowe!"
                : "Pokaż instrukcje"
            }}
          </div>
        </v-alert>

        <ExploreNewButtons
          :pending="pending"
          :all-actions-done="allActionsDone"
          @next="page += Math.round(Math.random() * 5)"
        />
      </div>

      <!-- OPEN STATE -->
      <div v-else class="d-flex align-start ga-4 mb-4">
        <v-alert
          v-model="showInstructions"
          closable
          type="info"
          variant="tonal"
          class="mb-0 flex-grow-1"
          :icon="mdiInformation"
        >
          <div class="text-subtitle-1 font-weight-bold mb-2">Instrukcje:</div>
          <ul class="pl-0 mt-2" style="list-style: none">
            <li
              class="d-flex align-center mb-2"
              :class="{
                'text-medium-emphasis': actionExplored,
              }"
            >
              <v-icon
                :color="actionExplored ? 'success' : 'medium-emphasis'"
                class="mr-2"
              >
                {{
                  actionExplored
                    ? mdiCheckboxMarkedCircle
                    : mdiCheckboxBlankCircleOutline
                }}
              </v-icon>
              <span>
                Kliknij ikonkę "Eksploruj" w tabeli poniżej aby otworzyć
                odnośniki wyszukiwania do powiązanych z daną osobą informacji
                (wyłącz blokowanie wyskakujących okien).
              </span>
            </li>
            <li class="d-flex align-center mb-2">
              <v-icon
                color="medium-emphasis"
                class="mr-2"
                :icon="mdiCircleSmall"
              ></v-icon>
              <span
                >Spróbuj znaleźć interesujące i istotne informacje na temat tej
                osoby.</span
              >
            </li>
            <li
              class="d-flex align-center mb-2"
              :class="{
                'text-medium-emphasis': actionNoted,
              }"
            >
              <v-icon
                :color="actionNoted ? 'success' : 'medium-emphasis'"
                class="mr-2"
              >
                {{
                  actionNoted
                    ? mdiCheckboxMarkedCircle
                    : mdiCheckboxBlankCircleOutline
                }}
              </v-icon>
              <span
                >Dodaj znalezione informacje jako notatki w edytorze poniżej
                (jeśli są tego warte).</span
              >
            </li>
            <li
              class="d-flex align-center mb-2"
              :class="{
                'text-medium-emphasis': actionVoted,
              }"
            >
              <v-icon
                :color="actionVoted ? 'success' : 'medium-emphasis'"
                class="mr-2"
              >
                {{
                  actionVoted
                    ? mdiCheckboxMarkedCircle
                    : mdiCheckboxBlankCircleOutline
                }}
              </v-icon>
              <span
                >Na koniec, oddaj swój głos w tabeli w zależności od tego, czy
                ta osoba jest według Ciebie interesująca czy nie.</span
              >
            </li>
            <li class="d-flex align-center">
              <v-icon
                color="medium-emphasis"
                class="mr-2"
                :icon="mdiCircleSmall"
              ></v-icon>
              <span
                >Kiedy skończysz, kliknij przycisk "Następna osoba" aby przejść
                dalej.</span
              >
            </li>
          </ul>
        </v-alert>

        <ExploreNewButtons
          vertical
          :pending="pending"
          :all-actions-done="allActionsDone"
          @next="page += Math.round(Math.random() * 5)"
        />
      </div>

      <v-card class="table-card mb-4">
        <ExploreTable
          :page="page"
          :headers="headers"
          :items="tableItems"
          :total-items="totalItems"
          :pending="pending"
          :items-per-page="1"
          :sort-by="sortBy"
          disable-focus
          hide-default-footer
          no-data-text="Brak danych do wyświetlenia. Prawdopodobnie przejrzałeś wszystkie nowe powiązania."
          @action:explored="actionExplored = true"
          @action:voted="actionVoted = true"
        />
      </v-card>

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
import {
  mdiCheckboxBlankCircleOutline,
  mdiCheckboxMarkedCircle,
  mdiInformation,
  mdiCircleSmall,
} from "@mdi/js";
import { ref, computed } from "vue";
import { useListWithStats } from "~/composables/entity/listWithStats";
import type { PersonRich } from "~~/shared/model";
import type { Query } from "~~/server/api/nodes/index.get";
import { useCurrentUser } from "vuefire";

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

const allActionsDone = computed(
  () => actionExplored.value && actionNoted.value && actionVoted.value,
);

watch(allActionsDone, (done) => {
  if (done) {
    showInstructions.value = false;
  }
});

watch(page, () => {
  actionExplored.value = false;
  actionNoted.value = false;
  actionVoted.value = false;
});

const sortBy = ref([
  { key: "stats.votes.interesting", order: "desc" as const },
]);

const headers = computed(() => {
  const baseHeaders = [
    { title: "Imię i nazwisko", key: "name", sortable: false },
    { title: "Partie", key: "parties", sortable: false },
    { title: "Firmy", key: "companies", sortable: false },
    { title: "Wybory", key: "elections", sortable: false },
    {
      title: "Ostatnie zatrudnienie",
      key: "latestEmploymentStart",
      sortable: false,
      align: "center" as const,
    },
    {
      title: "Lata pracy",
      key: "experience",
      sortable: false,
      align: "center" as const,
    },
    {
      title: "Notatki",
      key: "notesCount",
      sortable: false,
      align: "center" as const,
    },
    {
      title: "Głosy łącznie",
      key: "stats.votes.interesting",
      sortable: false,
      align: "center" as const,
    },
    {
      title: "Twój głos",
      key: "userVote",
      sortable: false,
      align: "center" as const,
    },
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
      sortBy: "stats.votes.interesting",
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
