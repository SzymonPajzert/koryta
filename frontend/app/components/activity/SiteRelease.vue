<template>
  <section
    class="asr"
    :aria-label="`Nowa wersja strony, ${countLabel}`"
    data-testid="activity-release"
  >
    <!-- A line like the people's, in the same columns, so the rail still reads
         as one timeline; the green says it is the site's rather than
         somebody's. -->
    <p class="asr__head">
      <span class="asr__name">Nowa wersja strony</span>
      <span class="asr__sentence">{{ countLabel }}</span>
      <time class="asr__time" :datetime="at">{{ time }}</time>
    </p>

    <!-- The titles in a box of their own under the line, where a person's line
         has its pills: without one, an opened description floated between two
         rules with nothing to say which title it belonged to. -->
    <ul class="asr__list">
      <li
        v-for="change in shown"
        :key="change.id"
        class="asr__change"
        data-testid="activity-site-change"
      >
        <button
          type="button"
          class="asr__toggle"
          :aria-expanded="open.has(change.id)"
          data-testid="activity-site-change-toggle"
          @click="toggle(change.id)"
        >
          <!-- The tag runs on after the title's last word rather than standing
               beside it as a column of its own: at 375px that column squeezed
               the title into three lines of two words. -->
          <span class="asr__title"
            >{{ change.title
            }}<template v-if="change.area !== 'public'">
              {{ " " }}
              <span class="asr__area">{{
                AREA_LABELS[change.area]
              }}</span></template
            ></span
          >
          <v-icon
            :icon="open.has(change.id) ? mdiChevronUp : mdiChevronDown"
            size="18"
            class="asr__chevron"
          />
        </button>
        <div v-if="open.has(change.id)" class="asr__detail">
          <p class="asr__description">{{ change.description }}</p>
          <p class="asr__links">
            <NuxtLink v-if="change.link" :to="change.link" class="asr__link">
              Zobacz na stronie
              <v-icon :icon="mdiArrowRight" size="14" />
            </NuxtLink>
            <NuxtLink
              :to="`/qa#qa-${change.id}`"
              class="asr__link"
              data-testid="activity-site-change-qa"
            >
              Sprawdź, czy działa
              <v-icon :icon="mdiArrowRight" size="14" />
            </NuxtLink>
          </p>
        </div>
      </li>
      <li v-if="hidden > 0" class="asr__tail">
        <button
          type="button"
          class="asr__more"
          data-testid="activity-release-more"
          @click="expanded = true"
        >
          {{ moreTargetsLabel(hidden) }}
          <v-icon :icon="mdiChevronDown" size="14" />
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useDisplay } from "vuetify";
import { mdiArrowRight, mdiChevronDown, mdiChevronUp } from "@mdi/js";
import { moreTargetsLabel, type SiteChange } from "~~/shared/activityFeed";
import type { QaArea } from "~~/shared/qa";
import { nominativeNoun } from "~/composables/polish";

/** One rollout of the site on the /aktywnosc rail: the changelog entries that
 * went live together, each a title that opens to say what changed, with the
 * way to the page it is about and to its entry on /qa, where it can be
 * checked. The badge is the timeline's, like every line's. */
const props = defineProps<{
  at: string;
  changes: SiteChange[];
}>();

/** Only the two a reader might not expect: a public change is the default. */
const AREA_LABELS: Record<QaArea, string> = {
  public: "",
  contributor: "dla zalogowanych",
  admin: "panel admina",
};

/** Warsaw, like the lines' times: the day headings are Warsaw days. */
const CLOCK = new Intl.DateTimeFormat("pl-PL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Warsaw",
});

const time = computed(() => CLOCK.format(new Date(props.at)));

const countLabel = computed(
  () =>
    `${props.changes.length} ${nominativeNoun(props.changes.length, "zmiana", "zmiany", "zmian")}`,
);

/** Five titles, three on a phone, before it asks - a rollout can hold
 * twenty-seven, and the day's own lines should not have to be scrolled to. */
const { xs } = useDisplay();
const expanded = ref(false);
const shown = computed(() =>
  expanded.value ? props.changes : props.changes.slice(0, xs.value ? 3 : 5),
);
const hidden = computed(() => props.changes.length - shown.value.length);

const open = reactive(new Set<string>());

function toggle(id: string) {
  if (open.has(id)) open.delete(id);
  else open.add(id);
}
</script>

<style scoped>
/* ---- the line ---- */

/* 4px down so the line centres on the badge, as a person's does. */
.asr__head {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  font-size: 0.875rem;
  gap: 0 6px;
  line-height: 20px;
  margin: 0;
  padding-top: 4px;
}

/* The badge's green as ink: 6.43:1 on white. */
.asr__name {
  color: rgb(var(--v-theme-ink-sage));
  font-weight: 600;
}

.asr__sentence {
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.asr__time {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
  white-space: nowrap;
}

/* ---- the titles ---- */

/* The pills' sage, as a box: `ink-sage` and `ink-info` both clear AA on it,
   5.57:1 and 5.50:1. */
.asr__list {
  background: rgb(var(--v-theme-surface-sage));
  border-radius: 12px;
  list-style: none;
  margin: 8px 0 0;
  padding: 2px 12px;
}

.asr__change + .asr__change {
  border-top: 1px solid rgba(var(--v-theme-ink-sage), 0.18);
}

/* 36px a row at the least, the whole width of the box to aim at. */
.asr__toggle {
  align-items: flex-start;
  background: none;
  border: 0;
  color: rgb(var(--v-theme-ink-strong));
  cursor: pointer;
  display: flex;
  font: inherit;
  font-size: 0.875rem;
  gap: 8px;
  line-height: 20px;
  padding: 8px 0;
  text-align: start;
  width: 100%;
}

/* Regular weight, so the line above leads the box; and underlined under a
   pointer only - a tap left the opened title underlined, and then it looked
   like one more link beside the two it had just revealed. */
.asr__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

@media (hover: hover) {
  .asr__toggle:hover .asr__title {
    text-decoration: underline;
  }
}

.asr__toggle:focus-visible {
  border-radius: 4px;
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
}

/* White on the box, ink-neutral on white: 6.50:1. */
.asr__area {
  background: rgb(var(--v-theme-surface));
  border-radius: 999px;
  color: rgb(var(--v-theme-ink-neutral));
  display: inline-block;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 18px;
  padding: 0 7px;
  vertical-align: 1px;
  white-space: nowrap;
}

.asr__chevron {
  color: rgb(var(--v-theme-ink-sage));
  flex: none;
  margin-top: 1px;
}

/* ---- an opened title ---- */

.asr__detail {
  padding: 0 26px 10px 0;
}

.asr__description {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.8125rem;
  line-height: 1.45;
  margin: 0;
}

.asr__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0 20px;
  margin: 2px 0 0;
}

/* Taller to aim at than it looks: the padding is the tap area, the margin
   gives the height back to the layout. */
.asr__link {
  align-items: center;
  color: rgb(var(--v-theme-ink-info));
  display: inline-flex;
  font-size: 0.8125rem;
  font-weight: 500;
  gap: 2px;
  margin: -4px 0;
  padding: 10px 0;
  text-decoration: none;
}

.asr__link:hover,
.asr__link:focus-visible {
  text-decoration: underline;
}

/* ---- the rest of a big rollout ---- */

.asr__tail {
  border-top: 1px solid rgba(var(--v-theme-ink-sage), 0.18);
  padding: 8px 0;
}

.asr__more {
  align-items: center;
  background: none;
  border: 1px solid rgba(var(--v-theme-ink-sage), 0.35);
  border-radius: 14px;
  color: rgb(var(--v-theme-ink-info));
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  gap: 2px;
  line-height: 18px;
  padding: 5px 10px 5px 12px;
}

.asr__more:hover {
  background: rgb(var(--v-theme-surface));
  border-color: transparent;
}

.asr__more:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
}
</style>
