<template>
  <!-- In an entity page's row of actions (`EntityActions`): a labelled button
       in the control tint, like every other button in that row, which a phone
       folds to its icon (entity/Actions.vue). The tooltip says what the label
       cannot - and, on a phone, the label itself. -->
  <v-btn
    v-if="labelled"
    variant="tonal"
    :color="color"
    :prepend-icon="icon"
    :to="to"
  >
    {{ label }}
    <v-tooltip
      activator="parent"
      location="top"
      :disabled="!tooltip && !xs"
      :text="tooltip || label"
    />
  </v-btn>
  <!-- Anywhere else - the table's drawer - a neutral one is a plain icon
       button: a near-black outline round each of five admin tools outweighed
       the name they sit beside. One with a colour of its own keeps that
       colour's outline. Square at the control radius either way. -->
  <v-btn
    v-else
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

<script lang="ts">
// The setup block's imports are here too: the two blocks are one module, and
// its imports go at its top.
import { inject, type InjectionKey } from "vue";
import { useDisplay } from "vuetify";

/** Provided by `EntityActions`: the buttons inside it are labelled.
 *
 * Through the component tree rather than a prop, because most of these
 * buttons are not placed by the row itself. The person page's search menu,
 * its duplicate and split pair and the data request each draw this button
 * from inside a component of their own, and none of them has a reason to know
 * which row it is in. */
export const iconActionLabelledKey: InjectionKey<boolean> = Symbol(
  "icon-action-labelled",
);
</script>

<script setup lang="ts">
/** One of the secondary actions on an entity: an admin's tool, a page's link.
 *
 * Its look is decided by where it is. In the row of actions under an entity's
 * name it is a labelled tonal button, which a phone folds into a 40px square;
 * elsewhere it is the 44px icon button, captioned by a tooltip rather than by
 * a label, outlined in the icon's colour where it has one and plain where it
 * does not. `DialogProposeEditNode`'s default activator keeps its own copy of
 * that icon shape - it is an activator inside a dialog component, and every
 * other caller of that dialog would have had to be re-checked to share this.
 */
withDefaults(
  defineProps<{
    /** An `@mdi/js` path. */
    icon: string;
    /** What the button does: its label in a row of actions, and otherwise
     * what a screen reader says and, failing a `tooltip`, the tooltip too. */
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

const labelled = inject(iconActionLabelledKey, false);

/** A phone, where the row clips the label: the tooltip is then the only place
 * a sighted reader can find out what the square does. Wider, a tooltip that
 * only repeated the label beside it would be noise. */
const { xs } = useDisplay();
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
