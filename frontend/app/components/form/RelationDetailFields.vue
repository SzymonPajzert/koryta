<template>
  <v-row dense>
    <v-col cols="12" :md="wantsDates ? 6 : 12">
      <v-text-field
        v-model="details.name"
        :label="nameLabel"
        :placeholder="namePlaceholder"
        density="compact"
        hide-details
        :data-testid="`${prefix}-name`"
      />
    </v-col>
    <template v-if="wantsDates">
      <v-col cols="6" md="3">
        <v-text-field
          v-model="details.start_date"
          label="Od"
          placeholder="RRRR-MM-DD"
          density="compact"
          hide-details="auto"
          :rules="[relationDateRule]"
          :data-testid="`${prefix}-start`"
        />
      </v-col>
      <v-col cols="6" md="3">
        <v-text-field
          v-model="details.end_date"
          label="Do"
          placeholder="RRRR-MM-DD"
          density="compact"
          hide-details="auto"
          :rules="[relationDateRule]"
          :data-testid="`${prefix}-end`"
        />
      </v-col>
    </template>
    <template v-if="wantsElection">
      <!-- Which election it was, first: it is what the row on the page prints
           in bold beside „kandydatura", and without it a run for the Senate
           and one for a gmina council read alike. Not clearable - every
           candidacy was for something, and „Samorząd" is the answer where
           only that much is known. -->
      <v-col cols="12" md="6">
        <v-select
          v-model="details.position"
          :items="electionKinds"
          label="Typ wyborów"
          density="compact"
          hide-details
          :data-testid="`${prefix}-position`"
        />
      </v-col>
      <v-col cols="12" md="6">
        <v-select
          v-model="details.party"
          :items="parties"
          label="Partia"
          density="compact"
          hide-details
          clearable
          :data-testid="`${prefix}-party`"
        />
      </v-col>
      <!-- The whole row, now that the kind of election has the place beside
           the party: a committee is named the way PKW writes it, „KKW
           TRZECIA DROGA PSL-PL2050 SZYMONA HOŁOWNI", and half a dialog cuts
           that off. -->
      <v-col cols="12">
        <v-text-field
          v-model="details.committee"
          label="Komitet wyborczy"
          density="compact"
          hide-details
          :data-testid="`${prefix}-committee`"
        />
      </v-col>
      <!-- A win only. Unticked is "nobody said", not "lost": the server stores
           nothing for it, and the page draws „Wybrany" for a win and nothing
           otherwise - see `elected` in shared/api.ts. -->
      <v-col cols="12">
        <v-checkbox
          v-model="details.elected"
          label="Uzyskano mandat"
          density="compact"
          hide-details
          :data-testid="`${prefix}-elected`"
        />
      </v-col>
    </template>
    <slot />
  </v-row>
</template>

<script setup lang="ts">
/** What a relation says, as fields: the role or the name, when it ran, and for
 * a candidacy which election it was, the party, the committee and whether it
 * won.
 *
 * Shared by the dialog that adds a relation and the one that corrects an
 * existing one, because they are the same claim typed twice - the only
 * difference between them is what surrounds these fields. `npm run
 * check:duplication` counts .vue clones at 0.00% and this is the block that
 * would have broken it.
 */
import { computed } from "vue";
import type { EdgeType, ElectionPosition } from "~~/shared/model";
import { electionPositions, parties } from "~~/shared/misc";
import { relationDateRule } from "~/utils/relationDate";

export type RelationDetails = {
  name: string;
  start_date: string;
  end_date: string;
  party: string;
  committee: string;
  /** Which election a candidacy was for, stored in the edge's `position`.
   * Empty until somebody picks one: a candidacy added before the form asked
   * has none. */
  position: ElectionPosition | "";
  elected: boolean;
};

/** The kinds of election a candidacy can be for, in the order of
 * `electionPositions`: the local offices, then the national ones. They are the
 * values `/api/edges/create` and `/api/edges/update` accept, so nothing picked
 * here can be refused.
 *
 * „Samorząd" says only that the election was a local one. The pipeline stores
 * it on every local candidacy, because it does not keep which office the run
 * was for - so it is mostly here to be read back and narrowed down, and the
 * line under it says what it means. */
const electionKinds = electionPositions.map((kind) =>
  kind === "Samorząd"
    ? {
        title: kind,
        value: kind,
        props: { subtitle: "gdy wiadomo tylko, że to wybory samorządowe" },
      }
    : { title: kind, value: kind },
);

const props = defineProps<{
  /** The stored edge type, which decides which fields are on the form. */
  realType: EdgeType | undefined;
  /** What the enclosing dialog names its controls, so a test can tell the add
   * form's fields from the edit form's. */
  prefix: string;
  /** An example role that fits where the post was held better than the
   * default, which is a company's. */
  rolePlaceholder?: string;
}>();

const details = defineModel<RelationDetails>({ required: true });

const wantsElection = computed(() => props.realType === "election");
const wantsDates = computed(
  () => props.realType === "employed" || wantsElection.value,
);

const nameLabel = computed(() => {
  if (props.realType === "employed") return "Stanowisko / rola";
  if (wantsElection.value) return "Opis kandydatury";
  return "Nazwa powiązania";
});

const namePlaceholder = computed(
  () =>
    props.rolePlaceholder ??
    (props.realType === "employed" ? "np. prezes zarządu" : ""),
);
</script>
