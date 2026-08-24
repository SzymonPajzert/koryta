<template>
  <v-container>
    <h1 class="text-h4 mb-2">Panel administracyjny</h1>
    <p class="text-body-2 text-medium-emphasis mb-6">
      Przegląd podstron administracyjnych i zadań wymagających uwagi.
    </p>

    <!-- Subpages -->
    <h2 class="text-h6 mb-3">Podstrony</h2>
    <v-row class="mb-6">
      <v-col v-for="page in subpages" :key="page.to" cols="12" sm="6" md="4">
        <v-card :to="page.to" height="100%" variant="outlined">
          <v-card-item>
            <template #prepend>
              <v-icon :icon="page.icon" size="large" color="primary" />
            </template>
            <v-card-title>{{ page.title }}</v-card-title>
          </v-card-item>
          <v-card-text class="text-medium-emphasis">
            {{ page.desc }}
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Action items -->
    <div class="d-flex align-center mb-3">
      <h2 class="text-h6">Wymagające działania</h2>
      <v-spacer />
      <v-btn
        :icon="mdiRefresh"
        variant="text"
        size="small"
        :loading="pending"
        @click="loadSummary"
      />
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :text="error"
    />

    <v-row>
      <!-- Untriaged feedback -->
      <v-col cols="12" md="6">
        <v-card height="100%" variant="outlined">
          <v-card-item>
            <template #prepend>
              <v-icon :icon="mdiMessageAlertOutline" color="primary" />
            </template>
            <v-card-title>Nowe zgłoszenia</v-card-title>
            <template #append>
              <v-chip
                v-if="!pending"
                :color="
                  summary && summary.feedback.needsAction > 0
                    ? 'warning'
                    : 'success'
                "
                variant="flat"
              >
                {{ summary?.feedback.needsAction ?? 0 }}
              </v-chip>
              <v-progress-circular v-else indeterminate size="20" />
            </template>
          </v-card-item>

          <v-card-text>
            <div class="text-caption text-medium-emphasis mb-2">
              Wysłane przyciskiem „Zgłoś” albo z listy QA, jeszcze nietknięte.
            </div>

            <template v-if="pending">
              <v-skeleton-loader type="list-item-two-line@3" />
            </template>
            <template v-else-if="summary && summary.feedback.needsAction === 0">
              <v-alert
                type="success"
                variant="tonal"
                density="compact"
                :icon="mdiCheckCircleOutline"
                text="Brak nowych zgłoszeń."
              />
            </template>
            <template v-else-if="summary">
              <v-list density="compact" class="py-0">
                <v-list-item
                  v-for="item in summary.feedback.sample"
                  :key="item.id"
                  :title="item.pageTitle ?? item.route"
                  :subtitle="item.message"
                  lines="two"
                />
              </v-list>
              <div
                v-if="
                  summary.feedback.needsAction > summary.feedback.sample.length
                "
                class="text-caption text-medium-emphasis mt-2"
              >
                …i
                {{
                  summary.feedback.needsAction - summary.feedback.sample.length
                }}
                więcej.
              </div>
            </template>
          </v-card-text>

          <v-card-actions>
            <v-btn
              variant="text"
              color="primary"
              to="/admin/opinie"
              :append-icon="mdiChevronRight"
            >
              Przejdź do zgłoszeń
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <!-- Notes needing action -->
      <v-col cols="12" md="6">
        <v-card height="100%" variant="outlined">
          <v-card-item>
            <template #prepend>
              <v-icon :icon="mdiNoteEditOutline" color="primary" />
            </template>
            <v-card-title>Notatki wymagające działania</v-card-title>
            <template #append>
              <v-chip
                v-if="!pending"
                :color="
                  summary && summary.notes.needsAction > 0
                    ? 'warning'
                    : 'success'
                "
                variant="flat"
              >
                {{ summary?.notes.needsAction ?? 0 }}
              </v-chip>
              <v-progress-circular v-else indeterminate size="20" />
            </template>
          </v-card-item>

          <v-card-text>
            <div class="text-caption text-medium-emphasis mb-2">
              Źródła oznaczone jako „Nierozwiązane”.
            </div>

            <template v-if="pending">
              <v-skeleton-loader type="list-item-two-line@3" />
            </template>
            <template v-else-if="summary && summary.notes.needsAction === 0">
              <v-alert
                type="success"
                variant="tonal"
                density="compact"
                :icon="mdiCheckCircleOutline"
                text="Brak nierozwiązanych zgłoszeń."
              />
            </template>
            <template v-else-if="summary">
              <v-list density="compact" class="py-0">
                <v-list-item
                  v-for="(item, i) in summary.notes.sample"
                  :key="`${item.noteId}-${i}`"
                  :title="item.name ?? item.nodeId"
                  :subtitle="item.note"
                  lines="two"
                >
                  <template #append>
                    <v-chip v-if="item.adminType" size="x-small" label>
                      {{ noteAdminTypeLabel(item.adminType) }}
                    </v-chip>
                  </template>
                </v-list-item>
              </v-list>
              <div
                v-if="summary.notes.needsAction > summary.notes.sample.length"
                class="text-caption text-medium-emphasis mt-2"
              >
                …i
                {{ summary.notes.needsAction - summary.notes.sample.length }}
                więcej.
              </div>
            </template>
          </v-card-text>

          <v-card-actions>
            <v-btn
              variant="text"
              color="primary"
              to="/admin/notatki"
              :append-icon="mdiChevronRight"
            >
              Przejdź do notatek
            </v-btn>
            <v-spacer />
            <!-- The queue reads on a phone, which is where this dashboard is
                 most often opened, so it is one tap from here. -->
            <v-btn
              variant="text"
              color="primary"
              to="/admin/notatki/kategoryzacja"
              :prepend-icon="mdiGestureTapButton"
            >
              Kategoryzuj<span v-if="summary?.notes.uncategorized">
                ({{ summary.notes.uncategorized }})</span
              >
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <!-- Unapproved manual revisions -->
      <v-col cols="12" md="6">
        <v-card height="100%" variant="outlined">
          <v-card-item>
            <template #prepend>
              <v-icon :icon="mdiHistory" color="primary" />
            </template>
            <v-card-title>Niezaakceptowane rewizje</v-card-title>
            <template #append>
              <v-chip
                v-if="!pending"
                :color="
                  summary && summary.revisions.unapprovedManual > 0
                    ? 'warning'
                    : 'success'
                "
                variant="flat"
              >
                {{ summary?.revisions.unapprovedManual ?? 0
                }}{{ summary?.revisions.truncated ? "+" : "" }}
              </v-chip>
              <v-progress-circular v-else indeterminate size="20" />
            </template>
          </v-card-item>

          <v-card-text>
            <div class="text-caption text-medium-emphasis mb-2">
              Ręczne (nieautomatyczne) rewizje stron i powiązań oczekujące na
              akceptację<span v-if="summary">
                — {{ summary.revisions.unapproved }} niezaakceptowanych
                łącznie</span
              >.
            </div>

            <template v-if="pending">
              <v-skeleton-loader type="list-item@3" />
            </template>
            <template
              v-else-if="summary && summary.revisions.unapprovedManual === 0"
            >
              <v-alert
                type="success"
                variant="tonal"
                density="compact"
                :icon="mdiCheckCircleOutline"
                text="Brak ręcznych rewizji do akceptacji."
              />
            </template>
            <template v-else-if="summary">
              <v-list density="compact" class="py-0">
                <!-- An edge revision has no page of its own, so it links to the
                     queue that lists it rather than to a detail view. -->
                <v-list-item
                  v-for="item in summary.revisions.sample"
                  :key="`${item.kind}-${item.id}`"
                  :to="
                    item.kind === 'edge'
                      ? '/admin/rewizje-krawedzi'
                      : `/admin/rewizje/${item.id}`
                  "
                  :title="item.name ?? item.id"
                  :subtitle="item.type"
                >
                  <template #prepend>
                    <v-icon
                      :icon="
                        item.kind === 'edge' ? mdiVectorPolyline : mdiHistory
                      "
                      size="small"
                      class="mr-2"
                      :aria-label="
                        item.kind === 'edge' ? 'Powiązanie' : 'Strona'
                      "
                    />
                  </template>
                </v-list-item>
              </v-list>
            </template>
          </v-card-text>

          <v-card-actions>
            <v-btn
              variant="text"
              color="primary"
              to="/admin/rewizje"
              :append-icon="mdiChevronRight"
            >
              Przejdź do rewizji
            </v-btn>
            <v-btn
              variant="text"
              color="primary"
              to="/admin/rewizje-krawedzi"
              :append-icon="mdiChevronRight"
            >
              Rewizje krawędzi
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <!-- Who has been working -->
    <div class="d-flex align-center mt-8 mb-3">
      <h2 class="text-h6">Aktywni w tym tygodniu</h2>
      <v-spacer />
      <v-btn
        variant="text"
        color="primary"
        size="small"
        to="/eksploruj/statystyki"
        :append-icon="mdiChevronRight"
      >
        Pełne statystyki
      </v-btn>
    </div>

    <StatsContributorTable
      :contributors="weekly?.contributors ?? []"
      :identified="weekly?.identified ?? false"
      :contributor-count="weekly?.contributorCount ?? 0"
      :window-days="WEEKLY_DAYS"
      :loading="pending"
    />
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  mdiGraphOutline,
  mdiHistory,
  mdiInboxArrowDown,
  mdiVectorPolyline,
  mdiNoteEditOutline,
  mdiTextBoxSearchOutline,
  mdiChartLine,
  mdiClipboardCheckOutline,
  mdiChevronRight,
  mdiCheckCircleOutline,
  mdiGestureTapButton,
  mdiRefresh,
  mdiMessageAlertOutline,
} from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { noteAdminTypeLabel } from "~/composables/notes";
import type { AdminSummary } from "~~/server/api/admin/summary.get";
import type { ActivityStats } from "~~/server/api/stats/activity.get";

definePageMeta({
  middleware: "admin",
});

useHead({
  title: "Panel administracyjny - koryta.pl",
});

const subpages = [
  {
    title: "Kolejka zmian",
    to: "/admin/rewizje/kolejka",
    icon: mdiInboxArrowDown,
    desc: "Propozycje od ludzi czekające na decyzję — wpisy i powiązania razem.",
  },
  {
    title: "Rewizje",
    to: "/admin/rewizje",
    icon: mdiHistory,
    desc: "Przeglądaj i akceptuj rewizje węzłów.",
  },
  {
    title: "Powiązania",
    to: "/admin/krawedzie",
    icon: mdiGraphOutline,
    desc: "Powiązania gotowe do publikacji - obie strony już opublikowane.",
  },
  {
    title: "Rewizje krawędzi",
    to: "/admin/rewizje-krawedzi",
    icon: mdiVectorPolyline,
    desc: "Zmiany krawędzi zaproponowane przez pipeline, jeszcze nierozpatrzone.",
  },
  {
    title: "Notatki",
    to: "/admin/notatki",
    icon: mdiNoteEditOutline,
    desc: "Zgłoszenia i źródła dodane przez użytkowników.",
  },
  {
    title: "Zgłoszenia",
    to: "/admin/opinie",
    icon: mdiMessageAlertOutline,
    desc: "Opinie i błędy zgłoszone przyciskiem na stronie i przy sprawdzaniu QA.",
  },
  {
    title: "QA",
    to: "/qa",
    icon: mdiClipboardCheckOutline,
    desc: "Lista zmian na stronie do sprawdzenia - otwarta dla każdego zalogowanego.",
  },
  {
    title: "Ekstrakcje",
    to: "/ekstrakcje",
    icon: mdiTextBoxSearchOutline,
    desc: "Ekstrakcje faktów ze źródeł.",
  },
  {
    title: "Statystyki",
    to: "/eksploruj/statystyki",
    icon: mdiChartLine,
    desc: "Stan bazy i kto ją ostatnio zmieniał.",
  },
];

/** The window the panel calls "this week". The stats page lets an admin widen
 * it; here it is fixed, because the question is "who is around right now". */
const WEEKLY_DAYS = 7;

const summary = ref<AdminSummary | null>(null);
const weekly = ref<ActivityStats | null>(null);
const pending = ref(true);
const error = ref<string | null>(null);

const loadSummary = async () => {
  pending.value = true;
  error.value = null;
  // Independent queues; one failing should not blank the other.
  const [summaryResult, weeklyResult] = await Promise.allSettled([
    authRequest<AdminSummary>("/api/admin/summary", { method: "GET" }),
    authRequest<ActivityStats>("/api/stats/activity", {
      method: "GET",
      query: { days: WEEKLY_DAYS },
    }),
  ]);

  if (summaryResult.status === "fulfilled") {
    summary.value = summaryResult.value;
  } else {
    console.error("Failed to load admin summary", summaryResult.reason);
    error.value = "Nie udało się wczytać podsumowania.";
  }

  if (weeklyResult.status === "fulfilled") {
    weekly.value = weeklyResult.value;
  } else {
    console.error("Failed to load weekly activity", weeklyResult.reason);
  }

  pending.value = false;
};

onMounted(loadSummary);
</script>
