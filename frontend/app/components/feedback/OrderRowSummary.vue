<template>
  <v-icon
    class="flex-0-0"
    size="small"
    :icon="feedbackKindConfig[item.kind].icon"
    :color="`ink-${feedbackKindTone[item.kind]}`"
    :title="feedbackKindConfig[item.kind].title"
  />
  <!-- The line's layout is the row's own (`arow-*`, global in
       admin/ExpandRow.vue), so a report reads the same in ordering mode as on
       the line that opens. -->
  <span
    v-if="item.adminStatus === 'in_progress'"
    class="arow-tag bg-surface-warning text-ink-warning"
  >
    W trakcie
  </span>
  <span
    class="fb-where arow-side text-caption text-medium-emphasis"
    :title="where"
  >
    {{ where }}
  </span>
  <span class="fb-message arow-grow text-body-2" :title="item.message">
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
import {
  feedbackKindConfig,
  feedbackKindTone,
  fixStateConfig,
} from "~/composables/feedback";
import { feedbackPlace } from "~/composables/feedbackAdmin";
import type { FixState } from "~~/shared/feedbackFixes";
import type { Feedback } from "~~/shared/model";

/** What a report is, in one line - enough to tell reports apart in a list:
 * the rows of ordering mode, and the line of a report row that opens. The
 * full text is in the tooltip and in the open row.
 *
 * The kind's colour is ink rather than fill: a bare icon on white has to carry
 * it alone, and the fills the chips use are too pale for that. */
const props = defineProps<{
  item: Feedback;
  /** Where a fix the code claims for it stands, when there is one. */
  fixState?: FixState | null;
}>();

/** Where it was written. Two reports can say the same few words - a QA
 * verdict with no note arrives as "Zgłoszono problem bez opisu." - and this
 * is what tells them apart. */
const where = computed(() => feedbackPlace(props.item));
</script>

<style scoped>
/* The where does not shrink; the message gives way. Shrinking is shared out by
 * width, so a long message used to take nearly all of it from the where and
 * squeeze the one fact that tells two reports apart down to „Mari…”. Its own
 * width up to 30% of the line, then an ellipsis. */
.fb-where {
  flex: 0 0 auto;
  max-width: 30%;
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
