<template>
  <v-card class="pside" data-testid="people-side">
    <v-card-title class="pside__title">Co dalej</v-card-title>
    <v-card-text class="pside__body">
      <ul class="pside__rows">
        <li v-for="row in rows" :key="row.key" class="pside__row">
          <span class="pside__count">{{ polishNumber(row.count) }}</span>
          <span class="pside__label">{{ row.label }}</span>
        </li>
      </ul>
      <v-btn
        color="tally"
        variant="flat"
        rounded="lg"
        height="44"
        block
        class="text-none mt-4"
        to="/oswiadczenia"
        data-testid="people-side-read"
        @click="pick('czytaj')"
      >
        Pomóż szukać
      </v-btn>
      <div class="pside__links">
        <OswiadczeniaArrowLink :to="PROGRESS_PAGE" @click="pick('postep')">
          Pełne dane
        </OswiadczeniaArrowLink>
        <OswiadczeniaArrowLink :to="BLOG_POST" @click="pick('blog')">
          Dowiedz się więcej
        </OswiadczeniaArrowLink>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { trackGoal } from "~/composables/analytics";
import { polishNumber } from "~/composables/polish";
import type { DeclarationPeople } from "~~/shared/declarations";

/** The right-hand column of the explorer's declarations panel, where the map
 * keeps its list of people: what is under way and what is missing, and the
 * ways on. A click on any of them is the panel's `home-explorer:pick`, the
 * goal the map's powiat clicks count under, so the two panels compare. */
const props = defineProps<{ people: DeclarationPeople }>();

const PROGRESS_PAGE = "/oswiadczenia/postep";
const BLOG_POST = "/blog/sprawdzamy-samorzadowcow";

const rows = computed(() => {
  const p = props.people;
  return [
    { key: "reading", count: p.reading, label: "czeka na czytelników" },
    { key: "held", count: p.held + p.mismatched, label: "czeka na decyzję" },
    {
      key: "preparing",
      count: p.cropped + p.downloaded,
      label: "w przygotowaniu",
    },
    { key: "searching", count: p.searching, label: "bez oświadczenia" },
  ].filter((row) => row.count > 0);
});

function pick(value: "czytaj" | "postep" | "blog") {
  trackGoal("home-explorer:pick", { panel: "oswiadczenia", value });
}
</script>

<style scoped>
.pside__title {
  font-size: 1.25rem;
  font-weight: 600;
  padding-bottom: 4px;
}

.pside__rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.pside__row {
  align-items: baseline;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(5ch, max-content) minmax(0, 1fr);
  padding: 8px 0;
}

.pside__count {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  text-align: right;
}

.pside__label {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 0.9375rem;
}

.pside__links {
  column-gap: 20px;
  display: flex;
  flex-wrap: wrap;
  margin-top: 4px;
}
</style>
