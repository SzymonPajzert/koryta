<template>
  <!-- What the map's side column shows before a region is picked. It used to
       be a card telling the reader to pick one, so on a computer the first
       screen was the map beside an empty column. Now it is the map's own
       numbers, the powiaty with the most people, each a pick in itself: a row
       does what clicking that patch of the map does. -->
  <v-card
    v-if="rows.length"
    border
    class="regions-top mt-2 mx-auto"
    max-width="400"
    data-testid="home-side-panel"
  >
    <v-card-item>
      <v-card-title>Najwięcej osób w bazie</v-card-title>
      <v-card-subtitle class="text-wrap">
        Powiaty, liczba opublikowanych osób
      </v-card-subtitle>
    </v-card-item>
    <div
      v-for="(row, index) in rows"
      :key="row.teryt"
      :class="{
        'regions-top__more': index >= SHOWN_NARROW,
        'regions-top__most': index >= SHOWN_MEDIUM,
      }"
    >
      <v-divider />
      <!-- A button, not a link: it changes the column rather than the page.
           Outside a v-list, Vuetify gives the row a tab stop and Enter/Space
           but no role, so it would be read as plain text. -->
      <v-list-item
        ref="rowEls"
        link
        role="button"
        class="regions-top__row"
        :aria-label="`${row.label}: ${polishCounting(row.people, 'osoba', 'osoby', 'osób')}. Pokaż te osoby.`"
        data-testid="home-region-row"
        @click="emit('pick', row.region)"
      >
        <!-- The name wraps rather than ending in an ellipsis: the powiaty that
             share a name carry their town in brackets - „Powiat grodziski
             (Grodzisk Wielkopolski)” - and the bracket is what an ellipsis
             cut, leaving two rows that read the same. The count never yields;
             it sits on the name's first line. -->
        <div class="d-flex align-baseline ga-3">
          <v-list-item-title class="flex-grow-1 text-wrap">
            {{ row.label }}
          </v-list-item-title>
          <span class="regions-top__count">{{ polishNumber(row.people) }}</span>
        </div>
        <!-- The row's share of the first one, in a neutral grey: a length to
             compare at a glance, not a colour, so it cannot be read as one of
             the map's. Under the name and the count both, so every track is
             the same length. -->
        <div
          class="regions-top__bar"
          :style="{ '--share': `${row.share}%` }"
          aria-hidden="true"
        />
        <template #append>
          <v-icon color="grey-darken-1" :icon="mdiChevronRight" />
        </template>
      </v-list-item>
    </div>
    <v-divider />
    <!-- „z&nbsp;nim”, so that no line ends on the one-letter „z”, cut off
         from the word it belongs to. -->
    <v-card-text class="regions-top__hint pt-3">
      <span class="d-none d-md-inline">
        Kliknij region na mapie, żeby zobaczyć powiązane z&nbsp;nim osoby.
      </span>
      <span class="d-md-none">
        Dotknij regionu na mapie, żeby zobaczyć powiązane z&nbsp;nim osoby.
      </span>
    </v-card-text>
  </v-card>
  <!-- Coming back to the page in the app, the counts are fetched again: the
       list's own outline meanwhile, so the column does not show the old
       instruction and then jump to three times its height. -->
  <v-card
    v-else-if="status === 'idle' || status === 'pending'"
    border
    class="mt-2 mx-auto"
    max-width="400"
  >
    <v-skeleton-loader type="list-item-two-line, list-item@5" />
  </v-card>
  <!-- No counts - none computed yet, or the request failed: the instruction
       this column used to be. Byte-for-byte what it was, and what the e2e seed
       renders, having no counts: tests/e2e/map_stats.spec.ts waits for
       "Wybierz region z mapy" to disappear as its proof that a powiat was
       picked. -->
  <v-card v-else border class="pt-2 mt-2 mx-auto" max-width="400">
    <v-card-title>Analizuj powiązania</v-card-title>
    <v-card-text>
      <span class="d-none d-md-inline">
        Wybierz region z mapy po lewej stronie, by zobaczyć powiązane osoby.
      </span>
      <span class="d-md-none">
        Wybierz region z mapy na górze, by zobaczyć powiązane osoby.
      </span>
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
import { mdiChevronRight } from "@mdi/js";
import { computed, useTemplateRef } from "vue";
import type { Powiat } from "~/composables/entity/regions";
import { polishCounting, polishNumber } from "~/composables/polish";
import { useRegionCounts } from "~/composables/stats/useRegionCounts";

const emit = defineEmits<{ pick: [region: Powiat] }>();

/** How many rows, by the width of the column. From 1280px the column beside
 * the map is tall enough for ten before the map ends; from 960 the map is
 * shorter and eight fit. Below 960 the list stands under the map rather than
 * beside it, so there is nothing to fill and it stays at five. All ten are
 * rendered and the rest hidden by width, so the server and the browser agree
 * on the markup. */
const SHOWN = 10;
const SHOWN_MEDIUM = 8;
const SHOWN_NARROW = 5;

const { data: counts, status } = useRegionCounts();

/** The powiaty with the most people, as the map counts them.
 *
 * Powiaty, not województwa: they are what the map colours, so the list names
 * its darkest patches, and a row picks exactly what a click on that patch
 * would. The stats job counts a person in the region an edge points at and in
 * the regions with a seat or owns edge to that target - one hop, with nothing
 * rolled up the hierarchy. A company seated in a powiat therefore never counts
 * towards its województwo, so a województwo's own number is a fraction of its
 * people (mazowieckie's was 174 on the 2026-10-15 export, its powiaty's 647),
 * and a ranking of them would rank that fraction.
 *
 * „Miasto Warszawa” is the one city among the 66 powiaty miejskie whose node
 * carries the word; the others are bare „Gdańsk”, „Kraków”. The row drops it
 * so the list reads as one list. The picked card keeps the node's name, as it
 * does after a click on the map. */
const rows = computed(() => {
  const powiaty: { teryt: string; name: string; people: number }[] = [];
  for (const r of counts.value ?? []) {
    // A powiat's code is four digits; two is a województwo, seven a gmina.
    if (!r.teryt || !/^\d{4}$/.test(r.teryt) || r.people <= 0) continue;
    powiaty.push({
      teryt: r.teryt,
      name: r.name ?? `Powiat ${r.teryt}`,
      people: r.people,
    });
  }
  const top = powiaty.sort((a, b) => b.people - a.people).slice(0, SHOWN);
  const most = top[0]?.people ?? 1;
  return top.map((r) => {
    const region: Powiat = {
      teryt: r.teryt,
      id: r.teryt,
      d: "",
      people: r.people,
      name: r.name,
    };
    return {
      teryt: r.teryt,
      label: r.name.replace(/^Miasto\s+/, ""),
      people: r.people,
      // At least a sliver: next to „1 284” a powiat of one person rounds
      // to 0%, and an empty track would read as nobody.
      share: Math.max(1, Math.round((100 * r.people) / most)),
      region,
    };
  });
});

const rowEls = useTemplateRef<{ $el: HTMLElement }[]>("rowEls");

/** For the picked card's way back: the reader returns to the row they left. */
function focusFirstRow() {
  rowEls.value?.[0]?.$el.focus({ preventScroll: true });
}

defineExpose({ focusFirstRow });
</script>

<style scoped>
/* Name and count on one line, the bar under both: the rows of a list the eye
   runs down, not the 64px rows of the people list a pick opens. */
.regions-top .regions-top__row {
  min-height: 0;
  padding-block: 10px;
}

.regions-top__count {
  flex-shrink: 0;
  white-space: nowrap;
  font-size: var(--k-ui-size);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.regions-top__bar {
  height: 4px;
  margin-top: 6px;
  border-radius: var(--k-r-pill);
  background:
    linear-gradient(
        rgba(var(--v-theme-on-surface), 0.38),
        rgba(var(--v-theme-on-surface), 0.38)
      )
      no-repeat 0 0 / var(--share) 100%,
    rgba(var(--v-theme-on-surface), 0.08);
}

/* Vuetify's own focus tint on a row is about 1.3:1 on white; these rows are
   the one way to pick a region from the keyboard, so they get a real ring. */
.regions-top .regions-top__row:focus-visible {
  outline: 2px solid rgba(var(--v-theme-on-surface), 0.87);
  outline-offset: -2px;
}

/* A sentence, so the UI text's 14px: the type system keeps 12 for labels and
   single-line meta, never for prose. The quiet ink keeps it under the list it
   explains. */
.regions-top__hint {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-ui-size);
  line-height: 1.45;
}

@media (max-width: 1279.98px) {
  .regions-top__most {
    display: none;
  }
}

@media (max-width: 959.98px) {
  .regions-top__more {
    display: none;
  }
}
</style>
