<template>
  <v-card-title class="text-wrap">
    <!-- Only the words are the h2: inside it, the bubble's „Co to jest: …”
         would be read out as part of the heading's name. -->
    <h2 class="card-heading">{{ title }}</h2>
    <InfoBubble :label="title"><slot /></InfoBubble>
  </v-card-title>
</template>

<script setup lang="ts">
// Imported rather than auto-imported, as in PageSection: MyRevisions' unit
// test mounts it bare, without Nuxt's component resolver.
import InfoBubble from "../InfoBubble.vue";

/** The title of a /profil card that carries a „(i)”: the visibility card on
 * the page and the proposals card under it. The title wraps rather than
 * ending in an ellipsis, and the bubble follows its last word inline, so on a
 * phone it is never left alone at the far edge of a two-line title.
 *
 * The slot is the bubble's text. */
defineProps<{ title: string }>();
</script>

<style scoped>
/* The words at the card title's own 16/600 - Vuetify's reset leaves an h2 the
   browser's 1.5em - and inline, so the bubble follows the last word. */
.card-heading {
  display: inline;
  font: inherit;
}

/* The space before the bubble: Vue drops the newline between `</h2>` and the
   bubble. */
.card-heading::after {
  content: " ";
}
</style>
