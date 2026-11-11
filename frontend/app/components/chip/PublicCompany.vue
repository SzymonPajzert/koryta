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
      >
        {{ chip.label }}
      </v-chip>
    </template>
  </v-tooltip>
</template>

<script lang="ts" setup>
import {
  mdiBankOutline,
  mdiDomain,
  mdiHelpCircleOutline,
  mdiOfficeBuildingOutline,
} from "@mdi/js";
import { publicSectorKnown, type Company } from "~~/shared/model";
import { isOfficeName } from "~~/shared/offices";

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
}>();

// Three states, not two. KRS can only ever prove public ownership, never the
// absence of it, so a place nobody has confirmed is never called private on the
// register's behalf.
const chip = computed(() => {
  if (!props.company) return undefined;

  // Public by definition, and not a company: said as what it is rather than
  // with the badge a publicly owned company gets (Szymon, 2026-11-11).
  if (isOfficeName(props.company.name)) {
    return {
      label: "Urząd",
      color: "primary",
      icon: mdiOfficeBuildingOutline,
      tooltip: "Urząd administracji publicznej.",
    };
  }

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
