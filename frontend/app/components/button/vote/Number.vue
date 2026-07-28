<template>
  <client-only>
    <div class="d-inline-flex align-center ga-2">
      <div
        class="d-inline-flex align-center bg-surface border rounded-pill overflow-hidden shadow-sm transition-all"
        style="border-color: rgba(var(--v-theme-on-surface), 0.12) !important"
        :class="{ 'elevation-2': isHoveringContainer }"
        @mouseenter="isHoveringContainer = true"
        @mouseleave="isHoveringContainer = false"
      >
        <v-tooltip location="top" :text="stepHint(1)">
          <template #activator="{ props: tip }">
            <v-btn
              v-bind="tip"
              :icon="mdiArrowUpBold"
              size="x-small"
              variant="text"
              :color="userVoteResult > 0 ? config.color : 'medium-emphasis'"
              class="rounded-0"
              :disabled="loading || userVoteResult >= 5"
              @click="handleVote(1)"
            />
          </template>
        </v-tooltip>
        <div
          class="text-caption font-weight-bold px-1 text-center"
          style="min-width: 28px"
          :class="{
            ['text-' + config.color]: userVoteResult > 0,
            ['text-' + config.downColor]: userVoteResult < 0,
          }"
        >
          {{ signed(userVoteResult) }}
          <v-tooltip activator="parent" location="top" max-width="260">
            <div>{{ currentHint }}</div>
            <div class="text-caption text-medium-emphasis">
              Skala od -5 do +5 - im wyżej, tym mocniejsze znalezisko.
            </div>
          </v-tooltip>
        </div>
        <v-tooltip location="top" :text="stepHint(-1)">
          <template #activator="{ props: tip }">
            <v-btn
              v-bind="tip"
              :icon="mdiArrowDownBold"
              size="x-small"
              variant="text"
              :color="userVoteResult < 0 ? config.downColor : 'medium-emphasis'"
              class="rounded-0"
              :disabled="loading || userVoteResult <= -5"
              @click="handleVote(-1)"
            />
          </template>
        </v-tooltip>
      </div>

      <span
        v-if="showLabel && currentLabel"
        class="text-caption text-medium-emphasis text-wrap"
      >
        {{ currentLabel }}
      </span>
    </div>
  </client-only>
</template>

<script setup lang="ts">
import { mdiArrowDownBold, mdiArrowUpBold } from "@mdi/js";
import { computed, ref } from "vue";
import type { VoteCategory } from "~~/shared/model";
import { useVotes, voteLevelLabel } from "~/composables/votes";

const { id, category, showLabel } = defineProps<{
  id: string;
  category: VoteCategory;
  /** Spell the current step out beside the pill, where there is room for it. */
  showLabel?: boolean;
}>();

const { userCategoryVotes, castVote, config, loading } = useVotes(id, category);

const userVoteResult = computed(() => userCategoryVotes.value[category] || 0);

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

const currentLabel = computed(() =>
  voteLevelLabel(category, userVoteResult.value),
);

const currentHint = computed(() =>
  currentLabel.value
    ? `${signed(userVoteResult.value)} - ${currentLabel.value}`
    : `${config.text}: jeszcze nie oceniono`,
);

/** What clicking an arrow would mean, rather than that it adds one. */
const stepHint = (delta: number) => {
  const next = userVoteResult.value + delta;
  if (next > 5 || next < -5) return "Krańcowa ocena";
  if (next === 0) return "0 - wycofaj ocenę";
  const label = voteLevelLabel(category, next);
  return label ? `${signed(next)} - ${label}` : signed(next);
};

const emit = defineEmits(["voted"]);

const handleVote = async (value: number) => {
  await castVote(value);
  emit("voted");
};

const isHoveringContainer = ref(false);
</script>
