<template>
  <!-- The id is what a card in Slack links back to: a report written here
       arrives with a "Otwórz wpis QA" button pointing at this anchor. -->
  <v-card :id="`qa-${item.id}`" class="qa-card mb-4" :data-qa-item="item.id">
    <v-card-item>
      <template #prepend>
        <v-icon :icon="stateIcon" :color="qaStateConfig[state].color" />
      </template>
      <v-card-title class="text-wrap">{{ item.title }}</v-card-title>
      <v-card-subtitle class="d-flex align-center flex-wrap ga-2 mt-1">
        <v-chip size="x-small" :color="qaAreaConfig[item.area].color" label>
          {{ qaAreaConfig[item.area].title }}
        </v-chip>
        <v-chip size="x-small" :color="qaStateConfig[state].color" label>
          {{ qaStateConfig[state].title }}
        </v-chip>
        <v-chip
          v-if="reportedByOthers && state !== 'issue'"
          size="x-small"
          color="error"
          variant="outlined"
          label
        >
          Ktoś zgłosił problem
        </v-chip>
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
      </v-card-subtitle>
    </v-card-item>

    <v-card-text>
      <p class="text-body-2 mb-3">{{ item.description }}</p>

      <div class="d-flex align-center flex-wrap ga-2">
        <v-btn
          size="small"
          variant="text"
          :prepend-icon="expanded ? mdiChevronUp : mdiChevronDown"
          @click="expanded = !expanded"
        >
          Jak sprawdzić
        </v-btn>
        <v-btn
          v-if="item.link"
          size="small"
          variant="tonal"
          color="primary"
          :prepend-icon="mdiOpenInNew"
          :to="item.link"
        >
          Otwórz
        </v-btn>
      </div>

      <v-expand-transition>
        <div v-if="expanded" class="mt-3">
          <ol class="qa-steps text-body-2">
            <li v-for="(step, index) in item.steps" :key="index" class="mb-1">
              {{ step }}
            </li>
          </ol>

          <v-textarea
            v-model="feedback"
            class="mt-4"
            label="Uwagi - co nie działa, co zmienić"
            rows="2"
            auto-grow
            variant="outlined"
            density="compact"
            hint="Zgłoszony problem i każda uwaga idą do zespołu tak samo, jak przez przycisk „Zgłoś”."
            persistent-hint
          />

          <div class="d-flex flex-wrap ga-2 mt-3">
            <v-btn
              size="small"
              color="success"
              :variant="myCheck?.status === 'ok' ? 'flat' : 'outlined'"
              :prepend-icon="mdiCheck"
              :loading="saving"
              @click="emit('save', 'ok', feedback)"
            >
              Działa
            </v-btn>
            <v-btn
              size="small"
              color="error"
              :variant="myCheck?.status === 'issue' ? 'flat' : 'outlined'"
              :prepend-icon="mdiAlertCircleOutline"
              :loading="saving"
              @click="emit('save', 'issue', feedback)"
            >
              Coś nie działa
            </v-btn>
            <span v-if="myCheck" class="text-caption align-self-center">
              Twoja ocena: {{ myVerdictLabel }}
            </span>
          </div>

          <div v-if="otherChecks.length > 0" class="mt-4">
            <div class="text-caption text-medium-emphasis mb-1">
              Co napisali inni
            </div>
            <div
              v-for="other in otherChecks"
              :key="other.userUid"
              class="d-flex ga-2 align-start mb-1"
            >
              <v-icon
                size="x-small"
                :icon="other.status === 'ok' ? mdiCheck : mdiAlertCircleOutline"
                :color="other.status === 'ok' ? 'success' : 'error'"
              />
              <span class="text-body-2">
                {{ other.feedback || qaStatusLabels[other.status] }}
              </span>
            </div>
          </div>
        </div>
      </v-expand-transition>
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
import {
  mdiAlertCircleOutline,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiOpenInNew,
  mdiProgressQuestion,
  mdiWrenchOutline,
} from "@mdi/js";
import { computed, ref, watch } from "vue";
import {
  qaAreaConfig,
  qaStateConfig,
  qaStatusLabels,
  type QaCheck,
  type QaCheckStatus,
  type QaItem,
  type QaItemState,
} from "~~/shared/qa";

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
  /** The page is writing this card's verdict right now. */
  saving?: boolean;
  /** The reports on /admin/opinie this change says it fixes (`QaItem.fixes`),
   * passed only to admins - nobody else can open them. */
  reportIds?: string[];
}>();

const emit = defineEmits<{
  save: [status: QaCheckStatus, feedback: string];
}>();

/** Entries nobody has confirmed open with the instructions showing - they are
 * the reason somebody came to this page. A settled one stays out of the way
 * until it is asked for. */
const expanded = ref(props.state !== "ok" || !!props.reportedByOthers);
const feedback = ref(props.myCheck?.feedback ?? "");

// The verdict can arrive after the card is on screen (the page loads them
// asynchronously), and it should not overwrite what is being typed.
watch(
  () => props.myCheck?.feedback,
  (stored) => {
    if (!feedback.value && stored) feedback.value = stored;
  },
);

const stateIcon = computed(() => {
  if (props.state === "ok") return mdiCheckCircleOutline;
  if (props.state === "issue") return mdiAlertCircleOutline;
  return mdiProgressQuestion;
});

const myVerdictLabel = computed(() =>
  props.myCheck ? qaStatusLabels[props.myCheck.status] : "",
);
</script>

<style scoped>
/* A link to one entry scrolls it to the top of the window, where the app bar
 * would cover its title - the same allowance the help page gives its
 * headings. */
.qa-card {
  scroll-margin-top: 96px;
}

.qa-steps {
  padding-left: 1.25rem;
}
</style>
