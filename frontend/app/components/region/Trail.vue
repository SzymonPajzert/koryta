<template>
  <!-- Where the region sits, widest first: „Województwo łódzkie › Powiat
       łowicki”, each a link to its own page. Szymon, board round
       region-lists-r1: "as breadcrumbs in below the name, e.g. Województwo
       X > Powiat X which would lead to the pages of the regions". -->
  <nav
    v-if="ancestors.length"
    class="region-trail"
    aria-label="Położenie regionu"
    data-testid="region-crumbs"
  >
    <ol class="region-trail__list">
      <li
        v-for="ancestor in ancestors"
        :key="ancestor.url"
        class="region-trail__item"
      >
        <!-- Underlined at rest, as the facts line under a person's or a
             company's name draws its links (entity/Facts.vue): a phone has
             no hover to find them by. -->
        <NuxtLink :to="ancestor.url" class="region-trail__link">{{
          ancestor.name
        }}</NuxtLink>
      </li>
    </ol>
  </nav>
</template>

<script setup lang="ts">
defineProps<{
  /** Widest first, from `useRegionAncestors`. Places only (Szymon,
   * 2026-11-18): not the kind of unit after them. */
  ancestors: { name: string; url: string }[];
}>();
</script>

<style scoped>
/* The facts line's rules (entity/Facts.vue): 14px in the quiet ink, the
   separator hung in the column gap and clipped where a wrapped line would
   start with it, so no line opens on a „›”. */
.region-trail__list {
  align-items: baseline;
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  column-gap: 21px;
  display: flex;
  flex-wrap: wrap;
  font-size: var(--k-ui-size);
  line-height: 1.45;
  list-style: none;
  margin: 0 0 0 -4px;
  overflow-x: clip;
  padding: 0 0 0 4px;
  row-gap: 2px;
}

.region-trail__item {
  min-width: 0;
  overflow-wrap: anywhere;
  position: relative;
}

/* The second `content` is the separator's alternative text, empty, so a
   screen reader reads the places and not the marks between them. */
.region-trail__item + .region-trail__item::before {
  color: rgba(var(--v-theme-on-surface), 0.38);
  content: "›";
  content: "›" / "";
  left: -14px;
  position: absolute;
}

.region-trail__link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: rgba(var(--v-theme-on-surface), 0.38);
  text-underline-offset: 3px;
}

.region-trail__link:hover,
.region-trail__link:focus-visible {
  text-decoration-color: currentColor;
}
</style>
