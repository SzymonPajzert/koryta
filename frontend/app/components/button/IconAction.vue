<template>
  <!-- A neutral one is a plain icon button: a near-black outline round
       each of five admin tools outweighed the name they sit beside. One with
       a colour of its own keeps that colour's outline. Square at the control
       radius either way. -->
  <v-btn
    icon
    :border="color ? 'sm current' : undefined"
    class="text-none pa-1 k-r-control"
    :color="color"
    size="44"
    :variant="color ? 'outlined' : 'text'"
    :to="to"
  >
    <v-icon :icon="icon" :color="color" />
    <!-- The button shows a glyph and nothing else, so the name a screen reader
         announces has to be in the DOM somewhere. Hidden by clipping rather
         than with `display: none`, which would take it out of the
         accessibility tree along with the pixels. -->
    <span class="visually-hidden">{{ label }}</span>
    <v-tooltip activator="parent" location="top">
      {{ tooltip || label }}
    </v-tooltip>
  </v-btn>
</template>

<script setup lang="ts">
/** One of the square icon buttons in an entity page's header.
 *
 * The shape is `DialogProposeEditNode`'s activator, which is the button these
 * were asked to look like: 44px, captioned by a tooltip rather than by a
 * label, outlined in the icon's colour where it has one and plain where it
 * does not. That one keeps its own copy -
 * it is an activator inside a dialog component, and every other caller of that
 * dialog would have had to be re-checked to share this.
 */
withDefaults(
  defineProps<{
    /** An `@mdi/js` path. */
    icon: string;
    /** What the button does, for a screen reader and, failing a `tooltip`, for
     * the tooltip too. */
    label: string;
    /** Said on hover, where there is more to say than the label. */
    tooltip?: string;
    /** Left unset for a neutral button. The theme's `primary` and `secondary`
     * are a pale sage and a pale pink - drawn as an outline and a glyph on a
     * white card they are close to invisible, so a colour here should be one
     * of Vuetify's own. */
    color?: string;
    /** Set to make the button a link rather than a click handler. */
    to?: string;
  }>(),
  { tooltip: undefined, color: undefined, to: undefined },
);
</script>

<style scoped>
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
