<template>
  <v-tooltip v-if="chip" :text="chip.tooltip" location="bottom">
    <template #activator="{ props: tooltipProps }">
      <!-- Outlined and never party-coloured, unlike `PartyChip` beside it.
           The two make different claims: the filled chip is the site's own
           reading of the committee through a curated table, this one is what
           the candidate said about themselves when PKW asked. A reader has to
           be able to tell them apart at a glance, so they never share a
           shape. -->
      <v-chip
        v-bind="tooltipProps"
        :prepend-icon="chip.icon"
        size="x-small"
        variant="outlined"
      >
        {{ chip.label }}
      </v-chip>
    </template>
  </v-tooltip>
</template>

<script lang="ts" setup>
import { mdiAccountCancelOutline, mdiCardAccountDetailsOutline } from "@mdi/js";

const props = defineProps<{
  /** PKW's verbatim answer for this candidacy, or nothing. */
  declaration: string | undefined;
}>();

/** How PKW words "I belong to no party". Matched on the prefix rather than on
 * equality: the phrasing varies across workbooks ("nie należy do partii
 * politycznej", "Nie należy do partii"), and everything that starts this way
 * is the same answer. */
const DECLARES_NONE = /^nie nale(ż|z)y do partii/i;

/** Strips the lead-in PKW puts in front of the party name in about a third of
 * the answers, so the chip reads as a party rather than as a sentence. The
 * rest already arrive as a bare name. */
const NAMES_PARTY = /^cz(ł|l)onek(\s+partii)?(\s+politycznej)?\s*:?\s*/i;

// Two states rendered and a third rendered as nothing at all. Absence is the
// common case - PKW only asked the question in some elections, and never on a
// council list - so it must never be drawn as a denial. Same discipline as
// `chip/PublicCompany.vue`: the register can prove a declaration was made,
// never that one was not.
const chip = computed(() => {
  const raw = props.declaration?.trim();
  if (!raw) return undefined;

  if (DECLARES_NONE.test(raw)) {
    return {
      label: "Bezpartyjny",
      icon: mdiAccountCancelOutline,
      tooltip:
        "Kandydat zadeklarował PKW przy tych wyborach, że nie należy do " +
        "żadnej partii. To jego własne oświadczenie, nie ustalenie serwisu.",
    };
  }

  const party = raw.replace(NAMES_PARTY, "").trim() || raw;
  return {
    label: party,
    icon: mdiCardAccountDetailsOutline,
    tooltip:
      `Przynależność zadeklarowana PKW przy tych wyborach: „${raw}". ` +
      "To oświadczenie kandydata o sobie - nie to samo co partia " +
      "odczytana przez serwis z nazwy komitetu.",
  };
});
</script>
