<template>
  <div class="pbar" data-testid="people-bar">
    <StatsCompositionBar :segments="segments" :summary="summary" />
    <p v-if="people.namesakes > 0" class="pbar__apart">
      osobno imiennicy:
      <a
        v-if="detail === 'stages'"
        href="#inna-data"
        class="pbar__apart-link"
        >{{ polishNumber(people.namesakes) }}</a
      >
      <strong v-else>{{ polishNumber(people.namesakes) }}</strong>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { polishNumber } from "~/composables/polish";
import { formatCount, ink, status } from "~/utils/chartTheme";
import { role } from "~~/shared/colors";
import type { CompositionSegment } from "~/components/stats/CompositionBar.vue";
import { peopleGroups, type DeclarationPeople } from "~~/shared/declarations";

/**
 * The people a declaration can publish, as one bar, the namesakes on a line of
 * their own under it, outside the total.
 *
 * `groups`, for readers (home, /oswiadczenia/postep): published in the
 * tally's green - the colour of the published-a-day columns beside it - under
 * way grey, the people with no declaration the empty remainder.
 *
 * `stages`, for /admin/oswiadczenia: every stage in the colours of the bar of
 * declarations by state under it - done green, what waits on an admin amber
 * and red and linked to its list, the work under way in greys darkening
 * towards publication, the people with no declaration the empty remainder.
 */
const props = withDefaults(
  defineProps<{
    people: DeclarationPeople;
    detail?: "groups" | "stages";
  }>(),
  { detail: "groups" },
);

const segments = computed<CompositionSegment[]>(() => {
  const p = props.people;
  if (props.detail === "stages") {
    return [
      {
        key: "published",
        label: "opublikowane",
        value: p.published,
        color: status.good,
      },
      {
        key: "held",
        label: "wstrzymane",
        value: p.held,
        color: status.warning,
        labelColor: ink.primary,
        to: "#wstrzymane",
      },
      {
        key: "mismatched",
        label: "pewnie błąd odczytu",
        value: p.mismatched,
        color: status.critical,
        to: "#inna-data",
      },
      {
        key: "reading",
        label: "u czytelników",
        value: p.reading,
        color: ink.secondary,
      },
      {
        key: "cropped",
        label: "wycinki do wysłania",
        value: p.cropped,
        color: ink.muted,
      },
      {
        key: "downloaded",
        label: "do wycięcia",
        value: p.downloaded,
        color: ink.axis,
        labelColor: ink.primary,
      },
      {
        key: "searching",
        label: "bez oświadczenia",
        value: p.searching,
        color: ink.track,
        labelColor: ink.primary,
      },
    ];
  }
  const g = peopleGroups(p);
  return [
    {
      key: "published",
      label: "opublikowane",
      value: g.published,
      color: role.tally,
    },
    { key: "underway", label: "w toku", value: g.underway, color: ink.muted },
    {
      key: "searching",
      label: "bez oświadczenia",
      value: g.searching,
      color: ink.track,
      labelColor: ink.primary,
    },
  ];
});

const summary = computed(() =>
  segments.value
    .map((segment) => `${segment.label}: ${formatCount(segment.value)}`)
    .join(", "),
);
</script>

<style scoped>
.pbar__apart {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.875rem;
  margin: 4px 0 0;
}

.pbar__apart strong {
  color: rgb(var(--v-theme-on-surface));
  font-variant-numeric: tabular-nums;
}

.pbar__apart-link {
  color: rgb(var(--v-theme-on-surface));
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
</style>
