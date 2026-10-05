<template>
  <span class="rev-line">
    <slot />
    <span v-if="$slots.rest" class="rev-line__rest">
      <slot name="rest" />
    </span>
  </span>
</template>

<script setup lang="ts">
/** The summary line of a revision row (`AdminExpandRow`'s `summary` slot),
 * which folds into two lines on a phone.
 *
 * The default slot is what names the row - icons, the name, a tag - and `rest`
 * is what describes it: which fields, who, how long ago. On a wide screen the
 * two run as one line, `rest` taking part in it as if it were not wrapped at
 * all; under 600px `rest` drops to a line of its own. Kept to one line there,
 * a row with two icons, a tag and a date left the name 40px, which is not a
 * name.
 *
 * Spans only: the whole line sits inside the row's toggle `<button>`, whose
 * content has to be phrasing content.
 */
</script>

<style scoped>
.rev-line {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Not a box of its own while the line is one line, so the `arow-*` helpers
 * inside it share out the width with everything before them. */
.rev-line__rest {
  display: contents;
}

@media (max-width: 599.98px) {
  .rev-line {
    flex-wrap: wrap;
    row-gap: 2px;
  }

  .rev-line__rest {
    display: flex;
    flex: 1 1 100%;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
}
</style>
