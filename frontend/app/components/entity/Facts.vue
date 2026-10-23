<template>
  <!-- One line under the name: „ur. 16 stycznia 1975 · Wikipedia ↗” on a
       person, „KRS: 0000026981 ↗ · Lokalizacja: Tarnów · Wikipedia ↗” on a
       company. A label is the quiet grey of every label on the site and the
       value after it the text's own ink, so the facts read before what they
       are called. -->
  <div class="entity-facts">
    <span
      v-for="fact in facts"
      :key="fact.key"
      class="entity-facts__item"
      :data-testid="fact.testid"
    >
      <!-- The gap belongs to the label: Vue drops the whitespace between two
           tags, and „REGON:123456785” reads as one number. Non-breaking, so a
           label never wraps off its own value. -->
      <span v-if="fact.label" class="entity-facts__label"
        >{{ fact.label }}&nbsp;</span
      >
      <!-- Underlined ink: the theme's sage is 1.85:1 as text on white, and
           sage is a fill on this site, never ink. The line is under the name
           only, not under the gap before the arrow. -->
      <a
        v-if="fact.url"
        :href="fact.url"
        target="_blank"
        rel="noopener"
        class="entity-facts__link"
      >
        <span class="entity-facts__name">{{ nbsp(fact.value) }}</span>
        <v-icon
          :icon="mdiOpenInNew"
          size="14"
          class="ml-1"
          aria-hidden="true"
        />
      </a>
      <template v-else>{{ nbsp(fact.value) }}</template>
    </span>
    <!-- What the page sets after its facts: a company's chips. No dot before
         them; the line's gap is what sets them off. -->
    <slot />
  </div>
</template>

<script setup lang="ts">
import { mdiOpenInNew } from "@mdi/js";
import { nbsp } from "~/utils/nbsp";

/** One fact on the line. */
export type EntityFact = {
  /** Unique on the line. */
  key: string;
  /** What the value is - „ur.”, „KRS:”, „Lokalizacja:” - with its own
   * punctuation. Left out where the value names itself: a link called
   * „Wikipedia” needs no label saying so. */
  label?: string;
  /** Printed through `nbsp`, as the bio is: a value is data, which cannot
   * write its own `&nbsp;`, and on a phone „magister zarządzania w turystyce
   * i sporcie” ended a line on its lone „i”. */
  value: string;
  /** Makes the value a link off the site, with the arrow that says so. */
  url?: string;
  testid?: string;
};

/** The facts line under an entity's name, one recipe for a person's page and
 * a company's: before it the two headers set the same facts two ways - all
 * quiet on one, labels and values apart on the other, dots kept on one phone
 * and dropped on the other. The table's drawer and the triage cards keep
 * `CardPersonInfo`'s label-over-value grid; this is for the line. */
defineProps<{
  facts: EntityFact[];
}>();
</script>

<style scoped>
/* A meta line, 14px, the facts divided by a middot. The dot hangs in the
   column gap, left of the item it precedes, and the line clips what overflows
   it on the left - so an item that wraps to open a new line loses its dot
   instead of starting with one, and its own text never moves. That is why it
   needs no phone rule. The clip edge sits 4px out from the text, which the dot
   at -11px is past and a link's focus ring is not. No measure: a line of facts
   is not prose, and held to the bio's 80ch a long education sent „Rejestr.io”
   onto a line of its own beside the empty rest of the column. */
.entity-facts {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.87);
  column-gap: 17px;
  display: flex;
  flex-wrap: wrap;
  font-size: var(--k-ui-size);
  line-height: 1.45;
  margin: 0 0 0 -4px;
  overflow-x: clip;
  padding-inline-start: 4px;
  row-gap: 2px;
}

.entity-facts__item {
  min-width: 0;
  overflow-wrap: anywhere;
  position: relative;
}

/* The second `content` gives the dot an empty alternative text, so a screen
   reader does not read it into the fact it hangs on („· Rejestr.io”). A
   browser without the syntax keeps the first. */
.entity-facts__item + .entity-facts__item::before {
  color: rgba(var(--v-theme-on-surface), 0.38);
  content: "·";
  content: "·" / "";
  left: -11px;
  position: absolute;
}

.entity-facts__label {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
}

.entity-facts__link {
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
}

.entity-facts__name {
  text-decoration: underline;
  text-decoration-color: rgba(var(--v-theme-on-surface), 0.38);
  text-underline-offset: 3px;
}

.entity-facts__link:hover .entity-facts__name,
.entity-facts__link:focus-visible .entity-facts__name {
  text-decoration-color: currentColor;
}
</style>
