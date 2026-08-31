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
      <v-col cols="12" md="6">
        <v-text-field
          v-model="details.committee"
          label="Komitet wyborczy"
          density="compact"
          hide-details
          :data-testid="`${prefix}-committee`"
        />
      </v-col>
    </template>
    <slot />
  </v-row>
</template>

<script setup lang="ts">
/** What a relation says, as fields: the role or the name, when it ran, and for
 * a candidacy the party and the committee.
 *
 * Shared by the dialog that adds a relation and the one that corrects an
 * existing one, because they are the same claim typed twice - the only
 * difference between them is what surrounds these fields. `npm run
 * check:duplication` counts .vue clones at 0.00% and this is the block that
 * would have broken it.
 */
import { computed } from "vue";
import type { EdgeType } from "~~/shared/model";
import { parties } from "~~/shared/misc";
import { relationDateRule } from "~/utils/relationDate";

export type RelationDetails = {
  name: string;
  start_date: string;
  end_date: string;
  party: string;
  committee: string;
};

const props = defineProps<{
  /** The stored edge type, which decides which fields are on the form. */
  realType: EdgeType | undefined;
  /** What the enclosing dialog names its controls, so a test can tell the add
   * form's fields from the edit form's. */
  prefix: string;
}>();

const details = defineModel<RelationDetails>({ required: true });

const wantsElection = computed(() => props.realType === "election");
const wantsDates = computed(
  () => props.realType === "employed" || wantsElection.value,
);

const nameLabel = computed(() => {
  if (props.realType === "employed") return "Stanowisko / rola";
  if (wantsElection.value) return "Nazwa wyborów";
  return "Nazwa powiązania";
});

const namePlaceholder = computed(() =>
  props.realType === "employed" ? "np. prezes zarządu" : "",
);
</script>
