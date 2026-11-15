<template>
  <section
    class="dpeople"
    aria-labelledby="dpeople-title"
    data-testid="declarations-people"
  >
    <div class="dpeople__head">
      <h3 id="dpeople-title" class="dpeople__title">
        {{
          total === 1
            ? "1 polityk na płatnym stanowisku"
            : `${polishNumber(total)} polityków na płatnych stanowiskach`
        }}
      </h3>
      <span class="dpeople__when">
        Liczone w nocy, stan na {{ longDate(people.exportDay) }}
      </span>
    </div>
    <!-- In the colours of the bar of declarations by state below it, every
         stage its own segment: one kind of chart on the page. -->
    <OswiadczeniaPeopleBar :people="people" detail="stages" />
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { polishNumber } from "~/composables/polish";
import { longDate } from "~~/shared/dates";
import type { DeclarationPeople } from "~~/shared/declarations";

/** The overview's people: the night's snapshot of where everybody a
 * declaration can publish stands, above the bar of declarations by state and
 * the chain that counts candidacies and crops. */
const props = defineProps<{ people: DeclarationPeople }>();

/** Namesakes are counted apart, outside the total, as everywhere else. */
const total = computed(() => props.people.people - props.people.namesakes);
</script>

<style scoped>
.dpeople {
  margin-bottom: 24px;
}

/* The head of the bar of declarations by state below it. */
.dpeople__head {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  justify-content: space-between;
  margin-bottom: 8px;
}

.dpeople__title {
  font-size: 0.875rem;
  font-weight: 600;
  margin: 0;
}

.dpeople__when {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8125rem;
}
</style>
