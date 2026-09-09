<template>
  <section class="px-2">
    <div class="sec-head">
      <v-icon v-if="icon" :icon="icon" size="18" class="sec-head__icon" />
      <h3 class="text-h6">{{ title }}</h3>
      <!-- The half of the explanation a reader may read rather than has to.
           „Tekst który wyjaśnia o co chodzi (...) robi straszny bloat na
           stronie (...) dodałbym to w jakimś dymku” is how it was reported,
           about a section whose heading was followed by five lines of prose.
           Opens on click as well as on hover, like `chip/RevisionStatus.vue`,
           because a phone never hovers - and focusable and labelled, or the
           sentence would exist only for a reader with a mouse. -->
      <v-tooltip
        v-if="info || $slots.info"
        location="bottom start"
        max-width="360"
        open-on-click
      >
        <template #activator="{ props: infoProps }">
          <v-icon
            v-bind="infoProps"
            :icon="mdiInformationOutline"
            size="18"
            class="sec-head__icon sec-head__info"
            tabindex="0"
            role="button"
            :aria-label="`Co to jest: ${title}`"
            data-testid="section-info"
          />
        </template>
        <slot name="info">{{ info }}</slot>
      </v-tooltip>
      <!-- Rendered only when somebody filled the slot: an empty `v-spacer` in
           a flex row is a 100%-wide invisible column, which would push a
           heading with no controls hard against the left edge of nothing. -->
      <template v-if="$slots.actions">
        <v-spacer />
        <slot name="actions" />
      </template>
    </div>

    <p v-if="lead" class="k-lead">{{ lead }}</p>
    <!-- The slot form, for the sections that say more than one thing before
         their entries - a coverage line and a "we are not showing you N of
         these" line, each with its own testid. It renders the paragraphs
         itself rather than being wrapped in one here: a `<p>` inside a `<p>`
         is closed by the parser at the first opening tag, and the second half
         of the lead would land outside the section's own markup. -->
    <slot name="lead" />

    <slot />
  </section>
</template>

<script lang="ts" setup>
import { mdiInformationOutline } from "@mdi/js";

/** The shell every section of an entity page is drawn in.
 *
 * Historia powiązań, Zmiany na stanowisku, Notatki and Fakty z artykułów are
 * four components with nothing in common but their looks, and each of them
 * carried its own copy of the heading rules. The copies drifted, and a reader
 * reported twice that the notes "odstają od reszty strony osoby" - so the
 * answer is not another round of matching values by hand but one component
 * that cannot be got wrong. The visual rules live in `app.vue` rather than
 * here, because the cards inside a section are drawn by whoever fills the
 * default slot and a scoped rule would not reach them.
 *
 * No bottom margin on purpose: the gap to the next section belongs to the page
 * that stacks them, and every caller already passes `mt-4`/`mt-6`. A margin
 * here would be added to that rather than instead of it - which is exactly
 * what the notes' own `mb-4` did, leaving 32px under them where their
 * neighbours leave 16.
 *
 * Attributes fall through to the `<section>`, so `class="mt-4"` and the
 * `data-testid` the e2e suite navigates by keep working from the call site.
 */
defineProps<{
  title: string;
  /** An mdi *path* - this app renders icons as svg paths, not class names. */
  icon?: string;
  /** The one-sentence explanation under the heading. Use the `lead` slot
   * instead where there is more than one, or where it needs a testid. */
  lead?: string;
  /** The rest of that explanation, behind the „(i)” in the heading. Use the
   * `info` slot instead where it is more than a sentence - a list of examples,
   * say. Nothing a reader needs in order to use the section belongs here. */
  info?: string;
}>();
</script>

<style scoped>
/* The one visual rule that does not live in `app.vue`: the bubble is drawn by
   this component rather than by whoever fills a slot, so a scoped selector
   does reach it. Cursor only - the tint is `sec-head__icon`'s. */
.sec-head__info {
  cursor: pointer;
}
</style>
