<template>
  <!-- The reader's actions first - „Zaproponuj zmianę”, then a person's vote,
       then whatever links the page adds - and the tools only some readers get
       after them, in a group of their own. Controls, not content, so kept
       out of search snippets. -->
  <div class="entity-actions" data-nosnippet>
    <slot />
    <!-- One group, on a line of its own under the reader's actions at every
         width, as on a phone. It used to take that line only once the row ran
         out of room, so at 1024 an admin found „Rewizje” under the vote on a
         person's page and beside the links on a company's, and at 1440 a tool
         that starts a merge stood in the reader's row as if it were one of
         their own actions. Hidden when it holds nothing, which is what a
         reader who is not an admin gets: every tool in it gates itself on a
         claim, so the line costs nobody else anything. -->
    <div v-if="$slots.tools" class="entity-actions__tools">
      <slot name="tools" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { provide } from "vue";
import { iconActionLabelledKey } from "~/components/button/IconAction.vue";

/** The row of actions under an entity's name, the same on a person's page and
 * a company's. What it is made of is Szymon's: on 2026-10-15, for the
 * company's page, „Zaproponuj zmianę” labelled, the rest icons on a phone and
 * the admin's tools wrapping; on 2026-10-16, for a person's, the vote right
 * after „Zaproponuj zmianę”. One row for both is the 2026-10-23 unification of
 * those two rounds.
 *
 * On a computer every action is a labelled button in the control tint, with
 * „Zaproponuj zmianę” first and its pencil in amber (`ButtonProposeChange`).
 * On a phone „Zaproponuj zmianę” keeps its words and every other button folds
 * to a 40px square of its icon, so the reader's actions fit one line. On both,
 * an admin's tools take the line under them.
 *
 * The buttons come from the pages and from components of their own, so the
 * row reaches them in two ways: `ButtonIconAction` learns from the tree that
 * it is in here and labels itself, and the phone's squares are drawn below
 * for any button in the row, whoever made it. */
provide(iconActionLabelledKey, true);
</script>

<style scoped>
.entity-actions,
.entity-actions__tools {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* The tools' line of their own, on a computer as on a phone - see the
   template. */
.entity-actions__tools {
  flex-basis: 100%;
}

.entity-actions__tools:empty {
  display: none;
}

@media (max-width: 599.98px) {
  /* Every button but „Zaproponuj zmianę” becomes a 40px square: the minimum
     touch target, and the height „Zaproponuj zmianę” has on a phone too. The
     label is clipped rather than `display: none`, which would take the
     button's name away from a screen reader along with the pixels. The vote's
     arrows are icon buttons already, sized for the table's rows at 32px. */
  .entity-actions :deep(.v-btn:not(.v-btn--icon, .propose-change)) {
    --v-btn-height: 40px;
    min-width: 40px;
    padding: 0;
    width: 40px;
  }

  .entity-actions
    :deep(.v-btn:not(.v-btn--icon, .propose-change) > .v-btn__prepend) {
    margin: 0;
  }

  .entity-actions
    :deep(.v-btn:not(.v-btn--icon, .propose-change) > .v-btn__content) {
    clip: rect(0, 0, 0, 0);
    height: 1px;
    margin: -1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }

  .entity-actions :deep(.v-btn--icon) {
    height: 40px;
    width: 40px;
  }
}
</style>
