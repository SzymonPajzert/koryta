<template>
  <div class="feed-item px-3 py-2" data-testid="feed-item">
    <div class="d-flex flex-wrap align-center gc-2 gr-1">
      <!-- Only a name that means the same person in the next response can be
           filtered on: a mask is one of several people and says nothing about
           which. -->
      <button
        v-if="actorClickable"
        type="button"
        class="feed-item__actor"
        :aria-label="`Pokaż tylko: ${actor.name}`"
        data-testid="feed-item-actor"
        @click="emit('select-actor', actor)"
      >
        <StatsContributorName :row="actor" :identified="identified" />
      </button>
      <StatsContributorName v-else :row="actor" :identified="identified" />

      <!-- Interpolated, never v-html: the name beside it and every page name
           below are text somebody typed. -->
      <span class="text-body-2">{{ sentence }}</span>
      <time
        class="text-caption text-medium-emphasis text-no-wrap"
        :datetime="batch.lastAt"
      >
        {{ time }}
      </time>
      <v-chip
        v-if="actor.newAdmin"
        size="x-small"
        variant="tonal"
        class="bg-surface-warning font-weight-medium"
      >
        okres próbny
      </v-chip>
    </div>

    <div class="feed-item__targets text-body-2 mt-1">
      <!-- Each target a flex box of its own, so the template's line breaks
           never turn into a space before the comma that follows it. -->
      <span
        v-for="(target, index) in shownTargets"
        :key="target.key"
        class="feed-item__target d-inline-flex align-center"
        :class="{ 'feed-item__target--sep': index < shownTargets.length - 1 }"
        data-testid="feed-item-target"
      >
        <NuxtLink v-if="target.href" :to="target.href" class="link-plain">
          {{ target.name }}
        </NuxtLink>
        <span v-else>{{ target.name }}</span>
        <span v-if="target.deleted" class="text-medium-emphasis ms-1">
          (usunięte)
        </span>
        <v-chip
          v-if="target.selfApproved"
          size="x-small"
          variant="tonal"
          class="bg-surface-warning font-weight-medium ms-1"
          data-testid="feed-item-self-approved"
        >
          własna propozycja
        </v-chip>
        <NuxtLink
          v-if="target.revisionHref"
          :to="target.revisionHref"
          class="link-plain text-caption text-ink-info d-inline-flex align-center ga-1 ms-2 text-no-wrap"
          data-testid="feed-item-revision"
        >
          <v-icon :icon="mdiFileCompare" size="x-small" />
          zmiana
        </NuxtLink>
      </span>
      <v-btn
        v-if="hiddenListed > 0"
        variant="text"
        size="x-small"
        class="ms-1 text-none"
        data-testid="feed-item-expand"
        @click="expanded = true"
      >
        {{ moreTargetsLabel(hiddenListed) }}
      </v-btn>
      <!-- Past the listed ones there is nothing to expand into, so this is
           words rather than a button. Held back while the button is showing:
           two "i jeszcze" in a row read as a stutter, and the sentence above
           already carries the full count. -->
      <span v-else-if="batch.moreTargets > 0" class="text-medium-emphasis ms-1">
        {{ moreTargetsLabel(batch.moreTargets) }}
      </span>
    </div>

    <div
      v-for="target in reasons"
      :key="target.key"
      class="text-caption text-medium-emphasis text-truncate"
      :title="target.reason"
      data-testid="feed-item-reason"
    >
      {{ target.name }}: {{ target.reason }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiFileCompare } from "@mdi/js";
import {
  describeFeedBatch,
  moreTargetsLabel,
  type FeedActor,
  type FeedBatch,
} from "~~/shared/activityFeed";

/** One line of `/aktywnosc`: who, what, when, and what it touched.
 *
 * Renders only what arrived. The revision link, the self-approval chip and the
 * reason are on a target only when the server decided this reader is an
 * established administrator, so there is no role check here to get wrong.
 */
const props = defineProps<{
  batch: FeedBatch;
  actor: FeedActor;
}>();

const emit = defineEmits<{ "select-actor": [actor: FeedActor] }>();

/** How many targets a line names before it asks. Five fit one line at the
 * page's width; a sitting of forty ratings would otherwise be a paragraph. */
const TARGETS_SHOWN = 5;

/** Below this a batch reads as one moment: a range "14:18–14:20" says nothing
 * a single time does not. */
const RANGE_FROM_MS = 5 * 60 * 1000;

/** Warsaw, whatever the browser's zone: the day headings are Warsaw days, and
 * a time from another clock would put an action under the wrong one. */
const CLOCK = new Intl.DateTimeFormat("pl-PL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Warsaw",
});

const actorClickable = computed(() => props.actor.isSelf || props.actor.named);

/** Only an established administrator is ever sent a uid. */
const identified = computed(() => props.actor.uid !== null);

const sentence = computed(() => describeFeedBatch(props.batch));

const time = computed(() => {
  const first = new Date(props.batch.firstAt);
  const last = new Date(props.batch.lastAt);
  const end = CLOCK.format(last);
  return last.getTime() - first.getTime() > RANGE_FROM_MS
    ? `${CLOCK.format(first)}–${end}`
    : end;
});

const expanded = ref(false);

const shownTargets = computed(() =>
  expanded.value
    ? props.batch.targets
    : props.batch.targets.slice(0, TARGETS_SHOWN),
);

const hiddenListed = computed(
  () => props.batch.targets.length - shownTargets.value.length,
);

const reasons = computed(() =>
  shownTargets.value.filter((target) => !!target.reason),
);
</script>

<style scoped>
/* A plain button around the chip, so the chip keeps its own tooltip and look
   and only gains a pointer. */
.feed-item__actor {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

/* Page names run long ("Samodzielny Publiczny Zakład Opieki Zdrowotnej…"), and
   a 375px screen has to wrap them rather than scroll. */
.feed-item__targets {
  overflow-wrap: anywhere;
}

/* Wide as its content and never wider than the line, so a name that does not
   fit wraps inside its own box. */
.feed-item__target {
  max-width: 100%;
  vertical-align: middle;
}

/* The comma belongs to the target it follows, so a wrap never starts a line
   with one. The space is a margin because a flex box drops trailing spaces. */
.feed-item__target--sep {
  margin-right: 0.3em;
}

.feed-item__target--sep::after {
  content: ",";
}
</style>
