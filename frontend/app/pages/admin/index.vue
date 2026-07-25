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
                      {{ noteTypeLabel(item.adminType) }}
                    </v-chip>
                  </template>
                </v-list-item>
              </v-list>
              <div
                v-if="summary.notes.needsAction > summary.notes.sample.length"
                class="text-caption text-medium-emphasis mt-2"
              >
                …i
                {{
                  summary.notes.needsAction - summary.notes.sample.length
                }}
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
              Ręczne (nieautomatyczne) rewizje oczekujące na akceptację<span
                v-if="summary"
              >
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
                <v-list-item
                  v-for="item in summary.revisions.sample"
                  :key="item.id"
                  :to="`/admin/rewizje/${item.id}`"
                  :title="item.name ?? item.id"
                  :subtitle="item.type"
                />
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
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  mdiHistory,
  mdiNoteEditOutline,
  mdiTextBoxSearchOutline,
  mdiChevronRight,
  mdiCheckCircleOutline,
  mdiRefresh,
} from "@mdi/js";
import { authRequest } from "~/composables/auth";
import type { AdminSummary } from "~~/server/api/admin/summary.get";

definePageMeta({
  middleware: "admin",
});

useHead({
  title: "Panel administracyjny - koryta.pl",
});

const subpages = [
  {
    title: "Rewizje",
    to: "/admin/rewizje",
    icon: mdiHistory,
    desc: "Przeglądaj i akceptuj rewizje węzłów.",
  },
  {
    title: "Notatki",
    to: "/admin/notatki",
    icon: mdiNoteEditOutline,
    desc: "Zgłoszenia i źródła dodane przez użytkowników.",
  },
  {
    title: "Ekstrakcje",
    to: "/ekstrakcje",
    icon: mdiTextBoxSearchOutline,
    desc: "Ekstrakcje faktów ze źródeł.",
  },
];

const noteTypeLabels: Record<string, string> = {
  missing_data: "Brakujące dane / Błąd",
  new_connection: "Nowe powiązanie",
  context: "Ciekawostka / Kontekst",
  other: "Inne",
};
const noteTypeLabel = (type: string) => noteTypeLabels[type] ?? type;

const summary = ref<AdminSummary | null>(null);
const pending = ref(true);
const error = ref<string | null>(null);

const loadSummary = async () => {
  pending.value = true;
  error.value = null;
  try {
    summary.value = await authRequest<AdminSummary>("/api/admin/summary", {
      method: "GET",
    });
  } catch (err) {
    console.error("Failed to load admin summary", err);
    error.value = "Nie udało się wczytać podsumowania.";
  } finally {
    pending.value = false;
  }
};

onMounted(loadSummary);
</script>
