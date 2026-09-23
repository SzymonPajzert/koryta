<template>
  <div class="feed-timeline">
    <section
      v-for="section in sections"
      :key="section.day"
      class="ft-day"
      data-testid="activity-day"
    >
      <h2 class="ft-day__label">{{ section.label }}</h2>

      <ol class="ft-rail">
        <li
          v-for="row in section.rows"
          :key="row.batch.id"
          class="ft-item"
          data-testid="feed-item"
        >
          <!-- The kind, before a word is read: a rating and a removal differ
               in glyph and in hue. Its name is the tooltip, not more text. -->
          <span
            class="ft-badge"
            :class="row.tone.surface"
            role="img"
            :aria-label="row.style.label"
            :title="row.style.label"
          >
            <v-icon :icon="row.style.icon" size="16" :class="row.tone.ink" />
          </span>

          <div class="ft-head">
            <p class="ft-line">
              <!-- Only a name that means the same person in the next response
                   can be filtered on: a mask is one of several people. No eye
                   glyph in front of either: "Anonim 3" already says it, and
                   the glyph pushed those names off the column every other
                   name starts on. The tooltip says who sees what. -->
              <button
                v-if="row.clickable"
                type="button"
                class="ft-actor ft-actor--button"
                :aria-label="`Pokaż tylko: ${row.actor.name}`"
                data-testid="feed-item-actor"
                @click="emit('select-actor', row.actor)"
              >
                <span class="ft-actor__name">{{ row.actor.name }}</span>
                <span
                  v-if="row.actor.isSelf"
                  class="ft-tag bg-surface-sage text-ink-sage"
                >
                  Ty
                </span>
                <v-tooltip
                  activator="parent"
                  location="bottom"
                  :text="row.explanation"
                />
              </button>
              <span v-else class="ft-actor ft-actor--masked">
                <span class="ft-actor__name">{{ row.actor.name }}</span>
                <v-tooltip
                  activator="parent"
                  location="bottom"
                  :text="row.explanation"
                />
              </span>
              <!-- Next to the person, not after the sentence: it says who they
                   are, and there it stays on the first line at every width. -->
              <template v-if="row.actor.newAdmin">
                {{ " " }}
                <span class="ft-tag bg-surface-warning text-ink-warning">
                  <v-icon :icon="mdiAccountClockOutline" size="12" />
                  okres próbny
                </span>
              </template>
              <!-- Interpolated, never v-html: the name beside it and every
                   page name below are text somebody typed. The spaces are
                   real ones, so the line copies and reads aloud as a
                   sentence rather than "Anna Nowakoceniła". -->
              {{ " " }}
              <span class="ft-sentence">{{ row.sentence }}</span>
            </p>
            <time class="ft-time" :datetime="row.batch.lastAt">
              {{ row.time }}
            </time>
          </div>

          <ul
            v-if="row.batch.targets.length > 0 || row.batch.moreTargets > 0"
            class="ft-targets"
          >
            <li
              v-for="target in shownTargets(row.batch)"
              :key="target.key"
              class="ft-target-group"
              data-testid="feed-item-target"
            >
              <!-- The pill is the name and nothing else, so it stays one
                   shape; what an administrator is told about it sits beside
                   it and wraps as its own unit. -->
              <component
                :is="target.href ? NuxtLink : 'span'"
                :to="target.href ?? undefined"
                class="ft-target"
                :class="{
                  'ft-target--link': !!target.href,
                  'ft-target--deleted': target.deleted,
                }"
                :title="target.name"
              >
                <v-icon
                  :icon="targetIcon(target.type)"
                  size="14"
                  class="ft-target__icon"
                />
                <span class="ft-target__name">
                  {{ nameParts(target).main
                  }}<span
                    v-if="nameParts(target).rest"
                    class="ft-target__rest"
                    >{{ nameParts(target).rest }}</span
                  >
                </span>
                <span v-if="target.deleted" class="ft-target__note">
                  (usunięte)
                </span>
              </component>
              <span
                v-if="target.selfApproved"
                class="ft-tag bg-surface-warning text-ink-warning"
                data-testid="feed-item-self-approved"
              >
                <v-icon :icon="mdiAlertOutline" size="12" />
                własna propozycja
              </span>
              <NuxtLink
                v-if="target.revisionHref"
                :to="target.revisionHref"
                class="ft-revision text-ink-info"
                data-testid="feed-item-revision"
              >
                <v-icon :icon="mdiFileCompare" size="12" />
                zmiana
              </NuxtLink>
            </li>

            <li v-if="hiddenListed(row.batch) > 0" class="ft-targets__tail">
              <button
                type="button"
                class="ft-more text-ink-info"
                data-testid="feed-item-expand"
                @click="expanded.add(row.batch.id)"
              >
                {{ moreTargetsLabel(hiddenListed(row.batch)) }}
                <v-icon :icon="mdiChevronDown" size="14" />
              </button>
            </li>
            <!-- Past the listed ones there is nothing to expand into, so this
                 is words rather than a button - and held back while the
                 button shows, since two "i jeszcze" read as a stutter. -->
            <li
              v-else-if="row.batch.moreTargets > 0"
              class="ft-targets__tail ft-rest text-ink-neutral"
            >
              {{ moreTargetsLabel(row.batch.moreTargets) }}
            </li>
          </ul>

          <p
            v-for="target in reasons(row.batch)"
            :key="target.key"
            class="ft-reason"
            :title="target.reason"
            data-testid="feed-item-reason"
          >
            <!-- Which page, only where there is a choice: under a single pill
                 the name would just repeat it. -->
            <span v-if="row.batch.targets.length > 1" class="ft-reason__name">{{
              `${target.name}:`
            }}</span>
            {{ target.reason }}
          </p>
        </li>
      </ol>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import { useDisplay } from "vuetify";
import { NuxtLink } from "#components";
import {
  mdiAccountClockOutline,
  mdiAlertOutline,
  mdiChevronDown,
  mdiFileCompare,
  mdiLightbulbOutline,
  mdiLinkVariant,
} from "@mdi/js";
import {
  describeFeedBatch,
  moreTargetsLabel,
  type FeedActor,
  type FeedBatch,
  type FeedTarget,
  type FeedTargetType,
} from "~~/shared/activityFeed";
import { contributorNameExplanation } from "~/utils/contributorName";
import { entityIcon } from "~/utils/entityIcon";
import { feedKindStyle, feedToneClasses } from "~/utils/feedKindStyle";

/** `/aktywnosc` as a timeline: each day a heading over a thin rail, and every
 * sitting hanging off it on a round badge whose glyph and hue say what kind of
 * thing was done. The line is the actor in bold, the sentence in a quieter
 * ink and the time pushed to the right; the pages it touched sit under it as
 * pills, each its own link with its type's icon, so two names can never run
 * together into one and neither can be mistaken for the sentence.
 *
 * Renders only what arrived: the revision link, the self-approval flag and the
 * reason are on a target only when the server decided this reader is an
 * established administrator, so there is no role check here to get wrong.
 */
const props = defineProps<{
  groups: { day: string; label: string; batches: FeedBatch[] }[];
  actorOf: (batch: FeedBatch) => FeedActor;
}>();

const emit = defineEmits<{ "select-actor": [actor: FeedActor] }>();

/** How many targets a line names before it asks: five on a screen that fits
 * them in a row or two, three on a phone, where each pill is a row of its own
 * and five made one sitting taller than the screen. */
const { xs } = useDisplay();
const targetsShown = computed(() => (xs.value ? 3 : 5));

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

/** The two target kinds that are not pages, and so have no entity icon. */
const OTHER_TARGET_ICONS: Partial<Record<FeedTargetType, string>> = {
  fact: mdiLightbulbOutline,
  edge: mdiLinkVariant,
};

function targetIcon(type: FeedTargetType): string {
  return OTHER_TARGET_ICONS[type] ?? entityIcon(type);
}

/** Where a name has two halves, the part that says which one it is. A fact is
 * named "person · institution" and a relation "source → target" by the server;
 * set in one weight, a fact read like a second person, and on a phone the
 * clamp ate the target of a relation. The text is unchanged - only the second
 * half is set lighter. */
const NAME_SEPARATORS: Partial<Record<FeedTargetType, string>> = {
  fact: " · ",
  edge: " → ",
};

function nameParts(target: FeedTarget): { main: string; rest: string } {
  const separator = NAME_SEPARATORS[target.type];
  const at = separator ? target.name.indexOf(separator) : -1;
  return at > 0
    ? { main: target.name.slice(0, at), rest: target.name.slice(at) }
    : { main: target.name, rest: "" };
}

function timeOf(batch: FeedBatch): string {
  const first = new Date(batch.firstAt);
  const last = new Date(batch.lastAt);
  const end = CLOCK.format(last);
  return last.getTime() - first.getTime() > RANGE_FROM_MS
    ? `${CLOCK.format(first)}–${end}`
    : end;
}

/** Everything a line draws that does not change when it is expanded, worked
 * out once per render of the list rather than once per binding. */
const sections = computed(() =>
  props.groups.map((group) => ({
    day: group.day,
    label: group.label,
    rows: group.batches.map((batch) => {
      const actor = props.actorOf(batch);
      const style = feedKindStyle[batch.kind];
      return {
        batch,
        actor,
        style,
        tone: feedToneClasses(style.tone),
        sentence: describeFeedBatch(batch),
        time: timeOf(batch),
        clickable: actor.isSelf || actor.named,
        // Only an established administrator is ever sent a uid.
        explanation: contributorNameExplanation(actor, actor.uid !== null),
      };
    }),
  })),
);

/** Batches whose whole listed slice is out. Keyed by batch id, so paging the
 * list further keeps what was opened. */
const expanded = reactive(new Set<string>());

function shownTargets(batch: FeedBatch) {
  return expanded.has(batch.id)
    ? batch.targets
    : batch.targets.slice(0, targetsShown.value);
}

function hiddenListed(batch: FeedBatch): number {
  return batch.targets.length - shownTargets(batch).length;
}

function reasons(batch: FeedBatch) {
  return shownTargets(batch).filter((target) => !!target.reason);
}
</script>

<style scoped>
/* ---- the day ---- */

.ft-day + .ft-day {
  margin-top: 28px;
}

/* A heading with a hairline running out to the right: enough to part one day
   from the next without drawing a box around either. */
.ft-day__label {
  align-items: center;
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  font-size: 0.8125rem;
  font-weight: 600;
  gap: 12px;
  letter-spacing: 0.01em;
  line-height: 1.5;
  margin: 0 0 14px;
}

.ft-day__label::after {
  background: rgba(var(--v-border-color), 0.12);
  content: "";
  flex: 1 1 auto;
  height: 1px;
}

/* ---- the rail ---- */

.ft-rail,
.ft-targets {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* The badge sits in a 28px gutter; the rail is a 2px line down its middle,
   drawn per item so it starts at the first badge and stops at the last. */
.ft-item {
  --ft-badge: 28px;
  min-width: 0;
  padding: 0 0 20px calc(var(--ft-badge) + 12px);
  position: relative;
}

.ft-item:last-child {
  padding-bottom: 0;
}

.ft-item::before {
  background: rgba(var(--v-border-color), 0.12);
  bottom: 0;
  content: "";
  left: calc(var(--ft-badge) / 2 - 1px);
  position: absolute;
  top: 0;
  width: 2px;
}

.ft-item:first-child::before {
  top: calc(var(--ft-badge) / 2);
}

.ft-item:last-child::before {
  bottom: auto;
  height: calc(var(--ft-badge) / 2);
}

.ft-item:only-child::before {
  display: none;
}

/* A ring of page colour around the badge, so the rail stops short of it
   instead of running into its edge. */
.ft-badge {
  align-items: center;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgb(var(--v-theme-surface));
  display: inline-flex;
  height: var(--ft-badge);
  justify-content: center;
  left: 0;
  position: absolute;
  top: 0;
  width: var(--ft-badge);
}

/* ---- the line ---- */

/* 4px down so the first line of text centres on the badge. */
.ft-head {
  align-items: flex-start;
  display: flex;
  gap: 12px;
  padding-top: 4px;
}

.ft-line {
  flex: 1 1 auto;
  font-size: 0.875rem;
  line-height: 20px;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.ft-actor {
  align-items: center;
  display: inline-flex;
  gap: 4px;
  max-width: 100%;
  vertical-align: top;
}

.ft-actor__name {
  font-weight: 600;
  min-width: 0;
}

.ft-actor--button {
  background: none;
  border: 0;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-align: start;
}

.ft-actor--button:hover .ft-actor__name,
.ft-actor--button:focus-visible .ft-actor__name {
  text-decoration: underline;
}

.ft-actor--button:focus-visible {
  border-radius: 4px;
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
}

/* A mask is somebody, not nobody: legible, only quieter than a name. */
.ft-actor--masked {
  color: rgb(var(--v-theme-ink-neutral));
}

.ft-actor--masked .ft-actor__name {
  font-weight: 500;
}

.ft-sentence {
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.ft-tag {
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.6875rem;
  font-weight: 600;
  gap: 3px;
  line-height: 18px;
  padding: 0 7px;
  vertical-align: middle;
  white-space: nowrap;
}

.ft-time {
  color: rgb(var(--v-theme-ink-neutral));
  flex: none;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
  white-space: nowrap;
}

/* ---- what it touched ---- */

.ft-targets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 8px;
}

/* A pill and whatever an administrator is told about it, wrapping together. */
.ft-target-group {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  max-width: 100%;
  min-width: 0;
}

/* A pill per target: its own fill, its own icon, its own edges, so where one
   name stops and the next starts is never a matter of reading. Sage, the
   header's colour at a quarter strength with the ink measured for it, says
   "this is a page you can open" without bringing in a second blue. Radius 14px
   rather than a capsule so a name that wraps makes a rounded box, not a
   lozenge. */
.ft-target {
  align-items: center;
  background: rgb(var(--v-theme-surface-muted));
  border-radius: 14px;
  color: rgb(var(--v-theme-ink-strong));
  display: inline-flex;
  font-size: 0.8125rem;
  gap: 6px;
  line-height: 18px;
  max-width: 100%;
  min-width: 0;
  padding: 4px 10px 4px 9px;
  text-decoration: none;
  transition: box-shadow 0.15s ease;
}

.ft-target--link {
  background: rgb(var(--v-theme-surface-sage));
  color: rgb(var(--v-theme-ink-sage));
}

.ft-target--link:hover {
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-ink-sage), 0.45);
}

.ft-target--link:hover .ft-target__name,
.ft-target--link:focus-visible .ft-target__name {
  text-decoration: underline;
}

.ft-target:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
}

.ft-target__icon {
  flex: none;
  opacity: 0.85;
}

/* Two lines at most, and the whole name on hover: a hospital's full name is
   ninety characters. Three on a phone, where two cut off exactly the words -
   "im. Jana Pawła II w Zamościu" - that tell one hospital from another. */
.ft-target__name {
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  display: -webkit-box;
  font-weight: 500;
  line-clamp: 2;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.ft-target__rest {
  font-weight: 400;
  opacity: 0.85;
}

/* Gone from the site: an outline where the fill was, the same dashed idiom
   `k-note` uses for "not a record". */
.ft-target--deleted {
  background: transparent;
  color: rgb(var(--v-theme-ink-neutral));
  outline: 1px dashed rgba(var(--v-border-color), 0.4);
  outline-offset: -1px;
}

.ft-target__note {
  font-size: 0.75rem;
  white-space: nowrap;
}

.ft-revision {
  align-items: center;
  display: inline-flex;
  font-size: 0.75rem;
  gap: 3px;
  text-decoration: none;
  white-space: nowrap;
}

.ft-revision:hover,
.ft-revision:focus-visible {
  text-decoration: underline;
}

.ft-targets__tail {
  align-items: center;
  display: inline-flex;
}

.ft-more {
  align-items: center;
  background: none;
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 14px;
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  gap: 2px;
  line-height: 18px;
  padding: 3px 8px 3px 10px;
}

.ft-more:hover {
  background: rgb(var(--v-theme-surface-info));
  border-color: transparent;
}

.ft-more:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
}

.ft-rest {
  font-size: 0.8125rem;
  padding: 0 2px;
}

/* ---- why ---- */

/* Plain muted text under the pills: a rule down its left ran beside the rail
   and read as a nested thread. Clamped to two lines, whole on hover. */
.ft-reason {
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: rgb(var(--v-theme-ink-neutral));
  display: -webkit-box;
  font-size: 0.75rem;
  line-clamp: 2;
  line-height: 1.45;
  margin: 6px 0 0;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.ft-reason + .ft-reason {
  margin-top: 2px;
}

.ft-reason__name {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 500;
}

/* ---- phone ---- */

/* The time stops being a column: pinned right it took a fifth of the width and
   broke "zaproponował/a 1 zmianę" after one word. It runs on after the
   sentence instead, and the sittings sit a little closer. */
@media (max-width: 599.98px) {
  .ft-head {
    display: block;
  }

  .ft-line {
    display: inline;
  }

  .ft-time {
    margin-left: 6px;
  }

  .ft-item {
    padding-bottom: 16px;
  }

  .ft-targets {
    margin-top: 6px;
  }

  .ft-target__name {
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }
}
</style>
