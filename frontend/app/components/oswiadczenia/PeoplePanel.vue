<template>
  <div class="ppanel" data-testid="people-panel">
    <p class="ppanel__head">
      <span class="ppanel__figure">{{ polishNumber(g.published) }}</span>
      <span class="ppanel__say">
        opublikowanych z
        {{ polishCountingGenitive(g.total, "samorządowca", "samorządowców") }}
      </span>
    </p>
    <OswiadczeniaPeopleBar :people="people" />
    <div v-if="days.dates.length > 1" class="ppanel__days">
      <p class="ppanel__days-title">Opublikowane dzień po dniu</p>
      <StatsDailyColumns
        :dates="days.dates"
        :bands="days.bands"
        value-title="Opublikowane osoby"
        empty-text="Jeszcze nikogo."
        :legend="false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { polishCountingGenitive, polishNumber } from "~/composables/polish";
import { publishedDays } from "~/utils/declarationPeople";
import { peopleGroups, type DeclarationPeople } from "~~/shared/declarations";

/** The home explorer's third panel, beside the map and the chart: how far
 * the declarations got, in people, as a bar in the panel's one green, and the
 * people a day it published. The explorer's right column holds the
 * rest (`OswiadczeniaPeopleSide`). */
const props = defineProps<{ people: DeclarationPeople }>();

const g = computed(() => peopleGroups(props.people));
const days = computed(() => publishedDays(props.people));
</script>

<style scoped>
.ppanel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 4px 0;
}

.ppanel__head {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 0;
}

.ppanel__figure {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 3.5rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
}

.ppanel__say {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 1.125rem;
  font-weight: 500;
}

.ppanel__days {
  margin-top: 8px;
}

.ppanel__days-title {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8125rem;
  font-weight: 600;
  margin: 0;
}

@media (max-width: 599.98px) {
  .ppanel__figure {
    font-size: 2.75rem;
  }
}
</style>
