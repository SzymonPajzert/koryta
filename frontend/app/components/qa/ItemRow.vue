<template>
  <!-- The id is what a card in Slack links back to: a report written here
       arrives with a "Otwórz wpis QA" button pointing at this anchor. -->
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="`qa-${item.id}`"
    class="qa-row"
    :tone="stateTone[state]"
    :data-qa-item="item.id"
  >
    <template #summary>
      <v-icon
        class="arow-fixed"
        size="small"
        :icon="stateIcon[state]"
        :color="`ink-${stateTone[state]}`"
        :title="qaStateConfig[state].title"
        :aria-label="qaStateConfig[state].title"
        role="img"
        aria-hidden="false"
      />
      <span
        class="arow-tag"
        :class="`bg-surface-${areaTone[item.area]} text-ink-${areaTone[item.area]}`"
      >
        {{ qaAreaConfig[item.area].title }}
      </span>
      <span class="qa-row__title arow-grow text-body-2">{{ item.title }}</span>
      <span
        v-if="reportedByOthers && state !== 'issue'"
        class="arow-tag bg-surface-danger text-ink-danger"
      >
        Ktoś zgłosił problem
      </span>
      <span
        v-if="myCheck"
        class="qa-row__verdict arow-fixed text-caption"
        :class="`text-ink-${stateTone[state]}`"
      >
        {{ qaStatusLabels[myCheck.status] }}
      </span>
    </template>

    <template #meta>
      <AdminRowFact label="Gdzie">
        {{ qaAreaConfig[item.area].title }}
      </AdminRowFact>
      <AdminRowFact label="Stan">{{ qaStateConfig[state].title }}</AdminRowFact>
    </template>

    <p class="text-body-2 mb-3">{{ item.description }}</p>

    <ol class="qa-row__steps text-body-2 mb-3">
      <li v-for="(step, index) in item.steps" :key="index" class="mb-1">
        {{ step }}
      </li>
    </ol>

    <div
      v-if="item.link || (reportIds?.length ?? 0) > 0"
      class="d-flex align-center flex-wrap ga-2 mb-4"
    >
      <v-btn
        v-if="item.link"
        size="small"
        variant="tonal"
        color="ink-sage"
        :prepend-icon="mdiOpenInNew"
        :to="item.link"
      >
        Otwórz
      </v-btn>
      <!-- The reports this change says it fixes, for whoever can open them.
           The label stays short: the report itself is one click away. -->
      <v-chip
        v-for="(reportId, index) in reportIds ?? []"
        :key="reportId"
        size="x-small"
        variant="outlined"
        label
        :to="`/admin/opinie#fb-${reportId}`"
        data-qa-report
      >
        <v-icon start :icon="mdiWrenchOutline" />
        Poprawia zgłoszenie{{
          (reportIds?.length ?? 0) > 1 ? ` ${index + 1}` : ""
        }}
      </v-chip>
    </div>

    <v-textarea
      v-model="feedback"
      label="Uwagi - co nie działa, co zmienić"
      rows="2"
      auto-grow
      variant="outlined"
      density="compact"
      hint="Zgłoszony problem i każda uwaga idą do zespołu tak samo, jak przez przycisk „Zgłoś”."
      persistent-hint
    />

    <div v-if="otherChecks.length > 0" class="mt-4">
      <div class="text-caption text-medium-emphasis mb-1">Co napisali inni</div>
      <div
        v-for="other in otherChecks"
        :key="other.userUid"
        class="d-flex ga-2 align-start mb-1"
      >
        <v-icon
          size="x-small"
          class="mt-1"
          :icon="other.status === 'ok' ? mdiCheck : mdiAlertCircleOutline"
          :color="other.status === 'ok' ? 'ink-success' : 'ink-danger'"
        />
        <span class="text-body-2">
          {{ other.feedback || qaStatusLabels[other.status] }}
        </span>
      </div>
    </div>

    <template #footer>
      <v-btn
        size="small"
        color="ink-success"
        :variant="myCheck?.status === 'ok' ? 'flat' : 'outlined'"
        :prepend-icon="mdiCheck"
        :loading="saving"
        @click="emit('save', 'ok', feedback)"
      >
        Działa
      </v-btn>
      <v-btn
        size="small"
        color="ink-danger"
        :variant="myCheck?.status === 'issue' ? 'flat' : 'outlined'"
        :prepend-icon="mdiAlertCircleOutline"
        :loading="saving"
        @click="emit('save', 'issue', feedback)"
      >
        Coś nie działa
      </v-btn>
      <span v-if="myCheck" class="text-caption">
        Twoja ocena: {{ qaStatusLabels[myCheck.status] }}
      </span>
    </template>
  </AdminExpandRow>
</template>

<script lang="ts" setup>
import {
  mdiAlertCircleOutline,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiOpenInNew,
  mdiProgressQuestion,
  mdiWrenchOutline,
} from "@mdi/js";
import { ref, watch } from "vue";
import type { RowTone } from "~/composables/rowVariant";
import {
  qaAreaConfig,
  qaStateConfig,
  qaStatusLabels,
  type QaArea,
  type QaCheck,
  type QaCheckStatus,
  type QaItem,
  type QaItemState,
} from "~~/shared/qa";

/** One changelog entry on /qa, as a line that opens: what changed and where
 * this reader stands on it, and in the open row how to check it and the
 * verdict to give. The same rows as the admin lists, so a report sent from
 * here and the entry it was about read alike on both pages. */
const props = defineProps<{
  item: QaItem;
  state: QaItemState;
  /** This reader's own verdict, if they have given one. */
  myCheck: QaCheck | null;
  /** Everybody else's, so a second checker sees what was already reported. */
  otherChecks: QaCheck[];
  /** Somebody else has already reported a problem here. It does not decide
   * this reader's verdict - it tells them what to look for. */
  reportedByOthers?: boolean;
  /** The page is writing this entry's verdict right now. */
  saving?: boolean;
  /** The reports on /admin/opinie this change says it fixes (`QaItem.fixes`),
   * passed only to admins - nobody else can open them. */
  reportIds?: string[];
}>();

const emit = defineEmits<{
  save: [status: QaCheckStatus, feedback: string];
}>();

/** Held by the page, so a link to an entry can open it. */
const expanded = defineModel<boolean>("expanded", { default: false });

/** Kept here rather than in the open part, so closing the row does not lose
 * what was typed. */
const feedback = ref(props.myCheck?.feedback ?? "");

// The verdict can arrive after the row is on screen (the page loads them
// asynchronously), and it should not overwrite what is being typed.
watch(
  () => props.myCheck?.feedback,
  (stored) => {
    if (!feedback.value && stored) feedback.value = stored;
  },
);

/** The colours of `qaStateConfig` and `qaAreaConfig` are Vuetify's, too pale
 * to be read as text; the rows use the ink/surface pairs instead. */
const stateTone: Record<QaItemState, RowTone> = {
  unchecked: "neutral",
  ok: "success",
  issue: "danger",
};

const stateIcon: Record<QaItemState, string> = {
  unchecked: mdiProgressQuestion,
  ok: mdiCheckCircleOutline,
  issue: mdiAlertCircleOutline,
};

const areaTone: Record<QaArea, Exclude<RowTone, "neutral">> = {
  public: "sage",
  contributor: "info",
  admin: "warning",
};
</script>

<style scoped>
.qa-row__steps {
  padding-left: 1.25rem;
}

/* On a phone the line breaks in two: the state, the tags and the verdict
 * first, the title under them on a line of its own, two lines at most. */
@media (max-width: 599.98px) {
  .qa-row :deep(.arow__toggle) {
    flex-wrap: wrap;
    row-gap: 0;
  }

  .qa-row__title {
    order: 1;
    flex-basis: 100%;
    margin: 0 0 6px 28px;
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .qa-row__verdict {
    margin-inline-start: auto;
  }
}
</style>
