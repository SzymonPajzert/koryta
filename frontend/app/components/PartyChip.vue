<template>
  <!-- One span, no wrapper. The <div> this used to be gave `text-overflow`
       below nothing to clip, so the 120px cap /eksploruj/tabela puts on the
       chip on a phone did nothing, and in card/PeopleList's `#append` the
       chips stacked one per line above the chevron rather than sitting beside
       it. Every other caller drops the chip into a flex row, where a block
       root and an inline one lay out the same. -->
  <span class="chip" :style :title>{{ party }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { OTHER_PARTY, partyChipPaint } from "~~/shared/misc";
import { ink } from "~~/shared/colors";

const { party } = defineProps<{
  party: string;
}>();

// The ink used to be a three-name map of the parties that get white text, with
// a near-black fallback, so Konfederacja's #102440 painted #090707 on navy at
// 1.29:1 and SLD's #D40E20 was one step behind it. `partyChipPaint` measures
// the fill instead, which a colour added to `partyColors` cannot get wrong -
// and it corrects PO too, whose white ink on #fca241 was 2.02:1.
//
// `backgroundColor` is left off entirely for a party `shared/misc` has no
// colour for, so that whatever surface the caller draws on shows through
// rather than being overridden with the string "undefined".
const style = computed(() => partyChipPaint(party) ?? { color: ink.strong });

/** „Inne” names no party, so the chip says what it stands for to whoever
 * stops on it. Every other chip is its own explanation. */
const title = computed(() =>
  party === OTHER_PARTY
    ? "Powiązanie polityczne spoza głównych partii"
    : undefined,
);
</script>

<style scoped>
.chip {
  /* Inline-block and not inline: an inline box ignores the width a caller caps
   * it at, which is what the ellipsis below needs to have anything to do. */
  display: inline-block;
  /* The chip is its own root now, so in a flex row it is the flex item - and a
   * flex item stretches to the cross axis unless told otherwise. Beside the
   * `text-h5` heading in EntityDetailsCard's `v-card-title` that made the chip
   * as tall as the person's name. It did not show while the root was a <div>
   * wrapping this span: the div stretched and the inline span inside it kept
   * its text height. Ignored outside a flex or grid parent, which is every
   * other caller. */
  align-self: center;
  padding: 0.1rem 0.4rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 0.3rem;
  font-weight: 550;
}
</style>
