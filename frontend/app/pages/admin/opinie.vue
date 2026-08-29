<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">Zgłoszenia od użytkowników</h1>
        <p class="text-body-2 text-medium-emphasis">
          Wszystko, co ktoś nam napisał: przyciskiem „Zgłoś” i oceniając wpisy
          na
          <NuxtLink to="/qa">liście zmian do sprawdzenia</NuxtLink>.
        </p>
      </v-col>
    </v-row>

    <v-row class="mb-2" align="center">
      <v-col cols="12" md="4">
        <v-select
          v-model="statusFilter"
          :items="statusFilterOptions"
          label="Status"
          density="compact"
          variant="outlined"
          hide-details
          clearable
        />
      </v-col>
      <v-col cols="12" md="8" class="text-medium-emphasis">
        {{ visible.length }} z {{ items.length }}
      </v-col>
    </v-row>

    <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">
      {{ loadError }}
    </v-alert>

    <v-progress-linear v-if="pending" indeterminate class="mb-4" />

    <!-- The id is what the "Otwórz w panelu" button in Slack links to. -->
    <v-card
      v-for="item in visible"
      :id="`fb-${item.id}`"
      :key="item.id"
      class="mb-4"
      :class="{ 'feedback-settled': isSettled(item) }"
    >
      <v-row no-gutters>
        <v-col cols="12" md="8" class="pa-4 border-e">
          <div class="d-flex align-center flex-wrap ga-2 mb-2">
            <v-chip
              :color="feedbackKindConfig[item.kind].color"
              size="small"
              variant="tonal"
            >
              <v-icon start :icon="feedbackKindConfig[item.kind].icon" />
              {{ feedbackKindConfig[item.kind].title }}
            </v-chip>
            <span class="text-caption text-medium-emphasis">
              {{ formatDate(item.createdAt) }}
            </span>
            <UserChip v-if="item.userUid" :uid="item.userUid" />
            <v-chip v-else size="x-small" label variant="outlined">
              anonimowo
            </v-chip>
          </div>

          <p class="text-body-1 mb-3" style="white-space: pre-wrap">
            {{ item.message }}
          </p>

          <div class="d-flex align-center flex-wrap ga-2">
            <!-- A verdict left on a QA changelog entry arrives here like any
                 other report; what it needs on the card is the entry it was
                 about, not the /qa route every one of them carries. -->
            <template v-if="item.context.qa">
              <v-chip
                size="x-small"
                label
                color="info"
                :to="`/qa#qa-${item.context.qa.itemId}`"
              >
                <v-icon start :icon="mdiClipboardCheckOutline" />
                QA: {{ item.context.qa.title }}
              </v-chip>
              <v-chip
                size="x-small"
                label
                variant="tonal"
                :color="item.context.qa.status === 'ok' ? 'success' : 'error'"
              >
                {{ qaStatusLabels[item.context.qa.status] }}
              </v-chip>
            </template>
            <v-chip v-else size="x-small" label :to="pageLink(item)">
              <v-icon start :icon="mdiLinkVariant" />
              {{ item.context.pageTitle || item.context.route }}
            </v-chip>
            <v-chip
              v-if="item.slack?.state === 'failed'"
              size="x-small"
              label
              color="warning"
              variant="tonal"
            >
              nie trafiło na Slacka
            </v-chip>
            <v-chip v-if="item.contact" size="x-small" label color="primary">
              <v-icon start :icon="mdiEmailOutline" />
              {{ item.contact }}
            </v-chip>
          </div>
        </v-col>

        <v-col cols="12" md="4" class="pa-4">
          <div class="text-subtitle-2 mb-2">Administracja</div>
          <v-select
            :model-value="item.adminStatus"
            :items="statusOptions"
            label="Status"
            density="compact"
            variant="outlined"
            hide-details
            class="mb-2"
            :loading="saving[item.id!]"
            @update:model-value="
              (val) => updateAdmin(item, { adminStatus: val })
            "
          />
          <v-textarea
            :model-value="item.adminNote ?? ''"
            label="Notatka"
            density="compact"
            variant="outlined"
            rows="2"
            auto-grow
            hide-details
            :loading="saving[item.id!]"
            @update:model-value="(val) => (draftNotes[item.id!] = val)"
            @blur="
              draftNotes[item.id!] !== undefined &&
              updateAdmin(item, { adminNote: draftNotes[item.id!] })
            "
          />
        </v-col>
      </v-row>
    </v-card>

    <v-alert v-if="!pending && items.length === 0" type="info" variant="tonal">
      Nic jeszcze nie wpłynęło.
    </v-alert>
  </v-container>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import {
  mdiLinkVariant,
  mdiEmailOutline,
  mdiClipboardCheckOutline,
} from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { feedbackKindConfig } from "~/composables/feedback";
import { qaStatusLabels } from "~~/shared/qa";
import { isFeedbackSettled } from "~~/shared/model";
import type { Feedback, FeedbackStatus } from "~~/shared/model";

definePageMeta({
  middleware: "admin",
});

const items = ref<Feedback[]>([]);
const pending = ref(true);
const loadError = ref("");
const saving = ref<Record<string, boolean>>({});
const draftNotes = ref<Record<string, string>>({});
const statusFilter = ref<FeedbackStatus | null>(null);

const statusOptions = [
  { title: "Nowe", value: "new" },
  { title: "W trakcie", value: "in_progress" },
  { title: "Załatwione", value: "resolved" },
  { title: "Nie robimy", value: "wont_fix" },
];

const statusFilterOptions = statusOptions;

const visible = computed(() =>
  statusFilter.value
    ? items.value.filter((i) => i.adminStatus === statusFilter.value)
    : items.value,
);

/** Settled is what the card greys out - "w trakcie" is still work in the queue
 * and stays at full contrast. The list lives in shared/model.ts because /qa now
 * asks the same question about a report the reader filed themselves. */
const isSettled = (item: Feedback) => isFeedbackSettled(item.adminStatus);

/** Reports are written by anyone, including signed-out visitors, so the route
 * is never trusted as a link target. The API only accepts site-relative paths;
 * this refuses anything else outright rather than rendering it. */
const pageLink = (item: Feedback) =>
  /^\/(?!\/)/.test(item.context.route) ? item.context.route : undefined;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  });

const load = async () => {
  pending.value = true;
  loadError.value = "";
  try {
    const data = await authRequest<{ feedback: Feedback[] }>(
      "/api/feedback/list",
      { method: "GET" },
    );
    items.value = data.feedback;
  } catch (error) {
    console.error("Failed to load feedback", error);
    loadError.value = "Nie udało się wczytać zgłoszeń.";
  } finally {
    pending.value = false;
  }
};

const updateAdmin = async (
  item: Feedback,
  patch: { adminStatus?: FeedbackStatus; adminNote?: string },
) => {
  const id = item.id;
  if (!id) return;
  saving.value[id] = true;
  try {
    await authRequest("/api/feedback/admin", {
      method: "POST",
      body: { id, ...patch },
    });
    Object.assign(item, patch);
  } catch (error) {
    console.error("Failed to update feedback", error);
  } finally {
    saving.value[id] = false;
  }
};

onMounted(load);
</script>

<style scoped>
/* Greyed rather than hidden: a settled report is still the record of what was
 * asked for, and the filter above is there when you want it gone entirely.
 * Hover and keyboard focus bring it back to full contrast so it stays
 * readable and its status select stays usable. */
.feedback-settled {
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.feedback-settled:hover,
.feedback-settled:focus-within {
  opacity: 1;
}
</style>
