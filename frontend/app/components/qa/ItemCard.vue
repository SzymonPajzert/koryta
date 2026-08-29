<template>
  <!-- The id is what a card in Slack links back to: a report written here
       arrives with a "Otwórz wpis QA" button pointing at this anchor. -->
  <v-card :id="`qa-${item.id}`" class="mb-4" :data-qa-item="item.id">
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
        <v-chip
          v-if="awaitingAcceptance && adminResolution"
          size="x-small"
          color="info"
          variant="outlined"
          label
        >
          Admin: {{ feedbackStatusConfig[adminResolution.status].title }}
        </v-chip>
      </v-card-subtitle>
    </v-card-item>

    <v-card-text>
      <p class="text-body-2 mb-3">{{ item.description }}</p>

      <!-- Outside `v-expand-transition` on purpose: a reported problem folds
           its instructions away once the reader has been through them, and the
           answer to their report is the one thing they should not have to
           unfold the card to find. -->
      <v-alert
        v-if="awaitingAcceptance"
        class="mb-3"
        type="info"
        variant="tonal"
        density="compact"
      >
        <div class="text-body-2">{{ resolutionMessage }}</div>
        <div class="d-flex flex-wrap ga-2 mt-2">
          <v-btn
            size="small"
            variant="tonal"
            color="info"
            :loading="saving"
            @click="emit('accept')"
          >
            Przyjmuję
          </v-btn>
          <v-btn
            size="small"
            variant="outlined"
            color="error"
            :prepend-icon="mdiAlertCircleOutline"
            :loading="saving"
            @click="emit('save', 'issue', feedback)"
          >
            Nadal nie działa
          </v-btn>
        </div>
      </v-alert>

      <!-- The verdict document still says "issue"; only the acceptance moved
           the entry back to unchecked, and saying so is what stops it reading
           as a change the reader confirmed themselves. -->
      <p
        v-else-if="myCheck?.status === 'issue' && myCheck.acceptedResolutionAt"
        class="text-caption text-medium-emphasis mb-3"
      >
        Zgłoszenie zostało zamknięte - wpis czeka na Twoje ponowne sprawdzenie.
      </p>

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
              :variant="state === 'ok' ? 'flat' : 'outlined'"
              :prepend-icon="mdiCheck"
              :loading="saving"
              @click="emit('save', 'ok', feedback)"
            >
              Działa
            </v-btn>
            <v-btn
              size="small"
              color="error"
              :variant="state === 'issue' ? 'flat' : 'outlined'"
              :prepend-icon="mdiAlertCircleOutline"
              :loading="saving"
              @click="emit('save', 'issue', feedback)"
            >
              Coś nie działa
            </v-btn>
            <span
              v-if="myCheck && !myCheck.acceptedResolutionAt"
              class="text-caption align-self-center"
            >
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
import { feedbackStatusConfig } from "~/composables/feedback";
import type { QaAdminResolution } from "~~/shared/model";

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
  /** What the team did with this reader's own report on this entry, when they
   * filed one. Nobody else's report is ever visible here. */
  adminResolution?: QaAdminResolution | null;
  /** The report above was settled and the reader has not answered that yet -
   * computed by the page, because it needs both this card's verdict and the
   * resolution to decide. */
  awaitingAcceptance?: boolean;
  /** The page is writing this card's verdict right now. */
  saving?: boolean;
}>();

const emit = defineEmits<{
  save: [status: QaCheckStatus, feedback: string];
  /** The reader takes the team's word for it - see `acceptResolution`. */
  accept: [];
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

/** Two different things to say, and the difference matters to whoever reported
 * the problem: "załatwione" invites them to look again, "nie robimy" is a
 * decision they may well want to argue with. */
const resolutionMessage = computed(() =>
  props.adminResolution?.status === "wont_fix"
    ? "Zgłosiłeś tu problem, a my oznaczyliśmy, że tego nie zrobimy. " +
      "Jeśli się z tym nie zgadzasz, napisz to jeszcze raz."
    : "Zgłosiłeś tu problem, a my oznaczyliśmy go jako załatwiony. " +
      "Sprawdź, czy faktycznie działa.",
);
</script>

<style scoped>
.qa-steps {
  padding-left: 1.25rem;
}
</style>
