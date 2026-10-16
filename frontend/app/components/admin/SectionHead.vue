<template>
  <div class="asec">
    <!-- The name, its count and the „(i)” run as one line of text, so on a
         phone a name that wraps keeps them after its last word instead of
         dropping both onto a line of their own. -->
    <div class="asec__heading k-section-title">
      <h2 class="asec__title">{{ title }}</h2>
      <span v-if="count !== undefined" class="asec__count" data-section-count>
        {{ shownCount }}
      </span>
      <InfoBubble v-if="info || $slots.info" :label="title">
        <slot name="info">{{ info }}</slot>
      </InfoBubble>
    </div>
    <div v-if="$slots.default" class="asec__actions">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

/** The heading over one section of an admin list: its name, how many entries
 * it holds, what it is for in a bubble, and room at the end for the section's
 * own controls (filters, "Pokaż zamknięte").
 *
 * The name is a section head like any other on the site (type.css
 * `k-section-title`: 24/600, 20 on a phone) - it used to be its own 20/700,
 * which out-weighed the public pages' heads under a title of the same size.
 * The count is a quiet grey pill, the pair the filter chips' counts use: it
 * was a near-black fill, the darkest mark on the page, beside every head. */
const props = defineProps<{
  title: string;
  count?: number | string;
  /** What the section is for; goes in the „(i)” bubble. The `info` slot
   * instead, for more than a string. */
  info?: string;
}>();

/** „19 060”, not „19060”. A string comes through as given („16+”). */
const shownCount = computed(() =>
  typeof props.count === "number"
    ? props.count.toLocaleString("pl-PL")
    : props.count,
);
</script>

<style>
.asec {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 24px 0 12px;
}

.asec__heading {
  flex: 0 1 auto;
  min-width: 0;
}

.asec__title {
  display: inline;
  font: inherit;
  margin: 0;
}

.asec__count {
  display: inline-block;
  margin-inline-start: 8px;
  vertical-align: 0.15em;
  letter-spacing: normal;
  min-width: 24px;
  padding: 0 8px;
  border-radius: var(--k-r-pill);
  text-align: center;
  font-size: var(--k-meta-size);
  font-weight: 600;
  line-height: 1.5rem;
  background: rgb(var(--v-theme-surface-muted));
  color: rgb(var(--v-theme-ink-neutral));
}

.asec__heading .sec-head__info {
  margin-inline-start: 8px;
  vertical-align: -0.1em;
}

.asec__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-inline-start: auto;
}
</style>
