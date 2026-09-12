<template>
  <v-tooltip location="bottom start" max-width="360" open-on-click>
    <template #activator="{ props: infoProps }">
      <v-icon
        v-bind="infoProps"
        :icon="mdiInformationOutline"
        size="18"
        class="sec-head__icon sec-head__info"
        tabindex="0"
        role="button"
        :aria-label="`Co to jest: ${label}`"
        data-testid="section-info"
      />
    </template>
    <slot />
  </v-tooltip>
</template>

<script lang="ts" setup>
import { mdiInformationOutline } from "@mdi/js";

/** The „(i)” beside a heading, and the half of an explanation a reader may read
 * rather than has to.
 *
 * „Tekst który wyjaśnia o co chodzi (...) robi straszny bloat na stronie (...)
 * dodałbym to w jakimś dymku” is how it was asked for, about a section whose
 * heading was followed by five lines of prose. It lived inside `PageSection`
 * until the help page needed the same bubble on headings that are not entity
 * sections; a second hand-written copy is exactly the drift `app.vue` warns
 * about, so it moved here and `PageSection` now renders this.
 *
 * Opens on click as well as on hover, like `chip/RevisionStatus.vue`, because a
 * phone never hovers - and focusable and labelled, or the sentence would exist
 * only for a reader with a mouse.
 *
 * The contract that comes with it: nothing a reader needs in order to use the
 * thing the heading names goes in here.
 */
defineProps<{
  /** What the bubble explains, for the accessible name: „Co to jest: …”. */
  label: string;
}>();
</script>

<style scoped>
/* Cursor only - the tint is `sec-head__icon`'s, which is global in `app.vue`. */
.sec-head__info {
  cursor: pointer;
}
</style>
