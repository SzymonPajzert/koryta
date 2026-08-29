<template>
  <v-tooltip v-if="chip" :text="chip.tooltip" location="bottom">
    <template #activator="{ props: tooltipProps }">
      <!-- `flat` where the chip has a colour, `tonal` where it does not.
           Tonal draws the label in the chip's own colour, and this theme's
           primary is a pale sage - 1.73:1 on its own 12% wash, which is how
           „Instytucja publiczna" came out unreadable. Flat puts black on the
           sage instead, which is 11.3:1 and reads as the badge it is. -->
      <v-chip
        v-bind="tooltipProps"
        :color="chip.color"
        :prepend-icon="chip.icon"
        size="x-small"
        :variant="chip.color ? 'flat' : 'tonal'"
        :class="{ 'chip--compact': compact }"
        :title="compact ? chip.tooltip : undefined"
      >
        <!-- The label is a span so `compact` has something to hide. Below md
             the chip is then an icon and nothing else, and the `title` above is
             the only name it has left - `aria-label` would be the tidier tool
             but this is a plain span with no role, where ARIA does not promise
             it is exposed at all, while `title` is the defined fallback.

             It is not there as a tooltip. A native one needs hover, and so does
             the v-tooltip wrapping this - which on the surface `compact` is for
             never opens either, because the chip sits inside the employment
             row's own anchor and a tap follows the link. The price is that a
             desktop reader hovering a compact chip gets both: weighed and paid,
             because the alternative was dropping the v-tooltip for these
             callers and losing the explanation on the one screen where it does
             open. -->

        <span :class="compact ? 'd-none d-md-inline' : undefined">{{
          chip.label
        }}</span>
      </v-chip>
    </template>
  </v-tooltip>
</template>

<script lang="ts" setup>
import { mdiBankOutline, mdiDomain, mdiHelpCircleOutline } from "@mdi/js";
import { publicSectorKnown, type Company } from "~~/shared/model";

const props = defineProps<{
  /** Takes the whole company rather than the flags, so a caller holding
   * something that may not be a company at all - an edge to an article, say -
   * can hand it straight over. */
  company: Company | undefined;
  /** Whether to say so when the ownership is unknown, rather than staying
   * silent. Worth it where the reader can do something about it - a company's
   * own card, which carries a "zaproponuj zmianę" button - and only noise in a
   * list, where most rows would carry it. */
  showUnknown?: boolean;
  /** Whether to fall back to the icon alone on a narrow screen.
   *
   * For the callers that repeat this chip down a list. "Instytucja publiczna"
   * is ~100px of a phone row's ~160px of text column, and it repeats on every
   * employment of somebody who has only ever worked in the public sector -
   * which is most of the people on this site, so the badge stops distinguishing
   * anything and only pushes the institution's name onto another line. The
   * icon still says it, the full label comes back above md, and a company's own
   * card - where the fact is the point rather than a repeated qualifier - does
   * not pass this. */
  compact?: boolean;
}>();

// Three states, not two. KRS can only ever prove public ownership, never the
// absence of it, so a place nobody has confirmed is never called private on the
// register's behalf.
const chip = computed(() => {
  if (!props.company) return undefined;

  if (props.company.isPublic) {
    return {
      label: "Instytucja publiczna",
      color: "primary",
      icon: mdiBankOutline,
      tooltip:
        "Podmiot należący do skarbu państwa lub samorządu. " +
        "Dotyczy też spółek zależnych od takich spółek.",
    };
  }

  if (publicSectorKnown(props.company)) {
    return {
      label: "Podmiot prywatny",
      color: undefined,
      icon: mdiDomain,
      tooltip: "Podmiot nie należy do skarbu państwa ani samorządu.",
    };
  }

  if (!props.showUnknown) return undefined;
  return {
    label: "Właściciel nieustalony",
    color: undefined,
    icon: mdiHelpCircleOutline,
    tooltip:
      "Nie wiadomo, kto jest właścicielem. KRS nie ujawnia akcjonariuszy " +
      "spółek akcyjnych, a instytucje spoza KRS - ministerstwa, urzędy - nie " +
      "mają w nim wpisu. Zaproponuj zmianę, jeśli wiesz.",
  };
});
</script>

<style scoped>
/* 959.98px is Vuetify's own md boundary, the one `d-md-inline` above switches
   at, so the padding and the label can never disagree about which side of it
   they are on. Both rules out-specify Vuetify's `.v-chip.v-chip--size-x-small`
   deliberately: a tie would be decided by whichever stylesheet the bundler
   happened to emit last. */
@media (max-width: 959.98px) {
  .v-chip.chip--compact {
    padding-inline: 4px;
  }

  /* The icon carries 4px of margin to hold it off a label that, here, is no
     longer rendered - without this the chip is an icon with a gap after it. */
  .v-chip.chip--compact :deep(.v-icon--start) {
    margin-inline-end: 0;
  }
}
</style>
