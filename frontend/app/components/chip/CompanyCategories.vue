<template>
  <div v-if="chips.length" class="d-flex flex-wrap align-center ga-1">
    <v-chip
      v-for="chip in chips"
      :key="chip.value"
      :to="asLinks ? chip.to : undefined"
      :prepend-icon="mdiTagOutline"
      size="x-small"
      variant="tonal"
      @click="follow($event, chip.to)"
      @auxclick="follow($event, chip.to)"
    >
      {{ chip.title }}
    </v-chip>
  </div>
</template>

<script lang="ts" setup>
import { mdiTagOutline } from "@mdi/js";
import { computed } from "vue";
import { asArray, type Company } from "~~/shared/model";
import { categoryFilterUrl, categoryTitle } from "~~/shared/companyCategories";

const props = defineProps<{
  /** Takes the whole company rather than the array, so a caller holding
   * something that may not be a company at all can hand it straight over -
   * the same contract `ChipPublicCompany` has. */
  company: Company | undefined;
  /** Render each chip as a link of its own. Only for a caller whose chips are
   * not already inside one - the company's summary card, and nothing else
   * today: every other caller puts them in a row or a card that is itself a
   * link, to the company or to a person.
   *
   * An `<a>` inside an `<a>` is not something HTML has. The browser's parser
   * closes the row's link where the chip's opens, so the page it builds is not
   * the page the server sent, and hydration then drew rows twice: PKP SKM's
   * „Właściciele" listed the two owners after PKP S.A., which is filed under
   * „Koleje", a second time. The home page's feed had 31 such chips, a
   * railwayman's page five. So the default is the safe one, and a caller has to
   * say it is not inside a link. */
  asLinks?: boolean;
}>();

/** Each chip links to the filter it corresponds to, because the category is
 * only useful as a way into the rest of the sector: a reader who sees „Koleje”
 * here wants the other railways, not a label.
 *
 * Read through `asArray` because a node written before 2026-07-28 stores its
 * arrays as `{"0": "koleje"}` maps - see `unwrap-array-fields.ts`. A value the
 * site no longer names is still shown, as itself: dropping it would hide that
 * the pipelines and `shared/companyCategories.ts` have drifted apart.
 */
const chips = computed(() =>
  asArray<string>(props.company?.categories).map((value) => ({
    value,
    title: categoryTitle(value),
    to: categoryFilterUrl(value),
  })),
);

/** Where a chip cannot be a link, it is still the way into its sector: a click
 * - or Enter, which Vuetify turns into one on a clickable chip - goes there.
 * Stopped and its default prevented, so the row around the chip does not also
 * follow its own link.
 *
 * A middle click, or a click with Ctrl, Cmd or Shift held, opens the sector in
 * a new tab, which is what the same click on a link does. Handled like a plain
 * click, the modified click went to the sector in this tab, and the middle
 * click - an `auxclick`, not a `click` - went past the chip to the row's link
 * and opened the company instead. */
function follow(event: MouseEvent | KeyboardEvent, to: string) {
  if (props.asLinks) return;
  const middle = "button" in event && event.button === 1;
  // `auxclick` is also the right button, whose menu is the browser's.
  if (event.type === "auxclick" && !middle) return;
  event.preventDefault();
  event.stopPropagation();
  if (middle || event.ctrlKey || event.metaKey || event.shiftKey) {
    navigateTo(to, { open: { target: "_blank" } });
  } else {
    navigateTo(to);
  }
}
</script>
