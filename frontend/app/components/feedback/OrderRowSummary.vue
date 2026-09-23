<template>
  <v-icon
    class="flex-0-0"
    size="small"
    :icon="feedbackKindConfig[item.kind].icon"
    :color="kindInk[item.kind]"
    :title="feedbackKindConfig[item.kind].title"
  />
  <span
    v-if="item.adminStatus === 'in_progress'"
    class="fb-tag bg-surface-warning text-ink-warning text-caption"
  >
    W trakcie
  </span>
  <span class="fb-where text-caption text-medium-emphasis" :title="where">
    {{ where }}
  </span>
  <span class="fb-message text-body-2" :title="item.message">
    {{ item.message }}
  </span>
  <v-icon
    v-if="fixState"
    class="flex-0-0"
    size="small"
    :icon="fixStateConfig[fixState].icon"
    :color="fixStateConfig[fixState].color"
    :title="`Poprawka: ${fixStateConfig[fixState].label}`"
    :aria-label="`Poprawka: ${fixStateConfig[fixState].label}`"
    role="img"
    aria-hidden="false"
    data-fix-state-icon
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { feedbackKindConfig, fixStateConfig } from "~/composables/feedback";
import type { FixState } from "~~/shared/feedbackFixes";
import type { Feedback, FeedbackKind } from "~~/shared/model";

/** What a report is, in one line - enough to tell reports apart while
 * ordering them. The full text is in the tooltip and on the card in the other
 * mode. */
const props = defineProps<{
  item: Feedback;
  /** Where a fix claimed on the QA list stands, when there is one. */
  fixState?: FixState | null;
}>();

/** Where it was written. Two reports can say the same few words - a QA
 * verdict with no note arrives as "Zgłoszono problem bez opisu." - and this
 * is what tells them apart. */
const where = computed(() =>
  props.item.context.qa
    ? `QA: ${props.item.context.qa.title}`
    : props.item.context.pageTitle || props.item.context.route,
);

/** The kind's colour as ink rather than fill: a bare icon on white has to
 * carry it alone, and the fills the chips use are too pale for that. */
const kindInk: Record<FeedbackKind, string> = {
  bug: "ink-danger",
  data: "ink-warning",
  idea: "ink-sage",
  other: "ink-neutral",
};
</script>

<style scoped>
.fb-tag {
  flex: none;
  padding: 0 6px;
  border-radius: 4px;
}

.fb-where {
  flex: 0 1 auto;
  max-width: 35%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fb-message {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The row wraps on a phone (see `OrderList`); the text takes a full line of
 * its own under everything else, two lines at most. */
@media (max-width: 599.98px) {
  .fb-where {
    max-width: none;
    flex: 1 1 0;
  }

  .fb-message {
    order: 1;
    flex-basis: 100%;
    margin: 0 0 6px 28px;
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
}
</style>
