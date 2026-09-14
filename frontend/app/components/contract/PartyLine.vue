<template>
  <div>
    <div class="party-line">
      <!-- Rendered only on the first line of a group. A consortium is one
           „Wykonawcy:" followed by three names, not the word three times -
           1 237 contracts in the first window have more than one supplier, and
           repeating the label reads as three separate contracts. The empty
           span keeps the names under each other rather than letting the second
           one start at the left margin. -->
      <span
        v-if="label"
        class="text-caption text-ink-neutral party-line__label"
      >
        {{ label }}:
      </span>
      <span v-else class="party-line__label" aria-hidden="true" />

      <!-- Resolved: the site's own cased name, linked. `nodeName` is
           denormalised at ingest, so a company renamed since then shows its old
           name - the link still lands, because the slug's last dash segment is
           the id and the words before it are ignored. -->
      <NuxtLink
        v-if="party.nodeId"
        class="link-plain party-line__name font-weight-medium"
        :to="nodeUrl"
      >
        {{ party.nodeName || plainName }}
      </NuxtLink>

      <!-- Unresolved: plain text, never a dead link. Most counterparties have
           no page here and never will - naming every one of them would have
           meant 5 274 new company pages, 3 457 of them for a single contract -
           and a link that goes nowhere is a worse answer than a name. -->
      <span
        v-else
        class="party-line__name"
        :class="{ 'text-ink-neutral': !party.name }"
        :tabindex="tooltip ? 0 : undefined"
        :role="tooltip ? 'button' : undefined"
      >
        {{ plainName }}
        <v-tooltip
          v-if="tooltip"
          activator="parent"
          location="bottom start"
          max-width="320"
          open-on-click
        >
          {{ tooltip }}
        </v-tooltip>
      </span>

      <!-- The seat, which is what tells two companies of the same name apart
           when neither has a page. -->
      <span v-if="party.city" class="text-caption text-ink-neutral">
        {{ party.city }}
      </span>
    </div>

    <ContractPeopleStrip
      v-if="people"
      :data="people"
      :company-name="party.nodeName"
      class="mt-1"
    />
  </div>
</template>

<script setup lang="ts">
import { contractPartyLabel } from "~~/shared/contracts";
import type { ContractParty, ContractPartyPeople } from "~~/shared/contracts";
import { companyShortName } from "~~/shared/names";

/** One side of a contract: „Zamawiający: Szpital Uniwersytecki w Krakowie".
 *
 * Four cases, and `contractPartyLabel` already decides between them wherever
 * the string is all that is needed. Here the string is not all that is needed -
 * a resolved party is a link, an individual gets a tooltip explaining the
 * omission - so the branches are spelled out, but the wording still comes from
 * that one function.
 */
const props = defineProps<{
  party: ContractParty;
  /** „Zamawiający", „Wykonawca", „Wykonawcy". Passed in rather than derived
   * from `party.role`, because a contract with several suppliers pluralises the
   * label once for the group and not once per line. Empty on every line of a
   * group after the first. */
  label: string;
  /** Who we know sits there, where the endpoint paid for the lookup. Absent on
   * the public list, which attaches no person data at all. */
  people?: ContractPartyPeople;
}>();

const nodeUrl = computed(() =>
  generateEntityUrl("place", props.party.nodeId ?? "", props.party.nodeName),
);

/** The register's name for a party, shortened by its legal form.
 *
 * `companyShortName` strips „SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" - 35
 * characters, and most of a two-line row on a phone - off the 27% of party
 * names that end in a spelled-out form. Where there is no name at all the
 * wording is `contractPartyLabel`'s.
 */
const plainName = computed(() =>
  props.party.name
    ? companyShortName(props.party.name)
    : contractPartyLabel(props.party),
);

/** Why a party has no name, for the two cases where that is a decision rather
 * than a gap. A named company needs no explanation. */
const tooltip = computed(() => {
  if (props.party.name) return undefined;
  if (props.party.kind === "osoba") {
    return "Rejestr podaje imię i nazwisko osoby prywatnej. Nie publikujemy go.";
  }
  if (props.party.redaction) {
    return props.party.redaction.basis
      ? `Podstawa wyłączenia jawności: ${props.party.redaction.basis}`
      : "Rejestr wyłączył jawność tej strony umowy.";
  }
  return undefined;
});
</script>

<style scoped>
/* Both rules here are the whole reason this is a component and not three lines
   of markup in `Row.vue`. „MIĘDZYNARODOWY INSTYTUT MECHANIZMÓW I MASZYN
   MOLEKULARNYCH POLSKIEJ AKADEMII NAUK" is one unbreakable token to a browser,
   and a 375px card that cannot break it grows to fit it - which scrolls the
   whole page sideways, on the surface this feature exists for. `min-width: 0`
   lets the flex item shrink below its content; `overflow-wrap: anywhere` gives
   the browser permission to break mid-token. Neither works without the other,
   and the e2e asserts `scrollWidth <= 375` because a unit test cannot see it. */
.party-line {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.party-line > * {
  min-width: 0;
}

.party-line__label {
  flex-shrink: 0;
}

/* The placeholder on a group's second and later lines: the same width as the
   label above it, so a consortium's names line up in one column instead of
   stepping left. `:empty` rather than a modifier class, because the only way
   this span is empty is the `v-else` branch. */
.party-line__label:empty::before {
  content: "";
  display: inline-block;
}

.party-line__name {
  font-size: 0.8125rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.party-line__name[role="button"] {
  cursor: pointer;
}
</style>
