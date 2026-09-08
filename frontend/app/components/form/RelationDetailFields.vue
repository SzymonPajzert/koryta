<template>
  <v-row dense>
    <!-- A personal tie has two readings and the site prints both, so the form
         asks for both. Named as pairs either side of an arrow rather than as a
         sentence, for the reason `AddRelationDialog` gives: Polish would want a
         case here and there is no declining an arbitrary surname. -->
    <template v-if="wantsBothSides">
      <v-col cols="12">
        <div class="text-caption text-medium-emphasis">
          Powiązanie osobiste czyta się z dwóch stron. Wpisz, kim jest osoba po
          strzałce dla osoby przed nią - inaczej „żona” pojawi się także przy
          mężu.
        </div>
      </v-col>
      <v-col cols="12" md="6">
        <v-text-field
          v-model="details.name"
          :label="forwardLabel"
          placeholder="np. żona"
          density="compact"
          hide-details="auto"
          :data-testid="`${prefix}-name`"
        />
      </v-col>
      <v-col cols="12" md="6">
        <v-text-field
          v-model="details.reverse_name"
          :label="backwardLabel"
          placeholder="np. mąż"
          density="compact"
          hide-details="auto"
          :hint="reverseHint"
          persistent-hint
          :data-testid="`${prefix}-reverse-name`"
        />
      </v-col>
      <v-col v-if="suggestions.length > 0" cols="12" class="pt-0">
        <div class="d-flex align-center flex-wrap ga-1">
          <span class="text-caption text-medium-emphasis mr-1">
            Podpowiedzi:
          </span>
          <v-chip
            v-for="suggestion in suggestions"
            :key="suggestion"
            size="small"
            variant="tonal"
            :data-testid="`${prefix}-reverse-suggestion-${suggestion}`"
            @click="details.reverse_name = suggestion"
          >
            {{ suggestion }}
          </v-chip>
        </div>
      </v-col>
    </template>

    <v-col v-else cols="12" :md="wantsDates ? 6 : 12">
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
 *
 * A `connection` is the one type that asks for two words rather than one. See
 * `Edge.reverse_name`: the tie between two people is named from whichever end
 * you read it, and one field could only ever be right on one of the two pages.
 */
import { computed } from "vue";
import type { EdgeType } from "~~/shared/model";
import { parties } from "~~/shared/misc";
import { relationDateRule } from "~/utils/relationDate";
import {
  isSymmetricRelation,
  reverseRelationSuggestions,
} from "~~/shared/relations";

export type RelationDetails = {
  name: string;
  /** Only ever filled for a `connection`; see `Edge.reverse_name`. Sent
   * regardless, because an empty string is what the other types already store
   * and the server writes the field either way. */
  reverse_name: string;
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
  /** The names at each end of the relation, source first, so the two-sided
   * fields can say which reading each one is. Optional: a caller that does not
   * know them gets neutral labels rather than no fields. */
  sourceName?: string;
  targetName?: string;
}>();

const details = defineModel<RelationDetails>({ required: true });

const wantsElection = computed(() => props.realType === "election");
const wantsDates = computed(
  () => props.realType === "employed" || wantsElection.value,
);
const wantsBothSides = computed(() => props.realType === "connection");

/** "Jan Kowalski → Anna Nowak", or a neutral stand-in where the caller could
 * not say who is at which end. */
function arrowLabel(from: string | undefined, to: string | undefined) {
  return from && to ? `${from} → ${to}` : undefined;
}

const forwardLabel = computed(
  () =>
    arrowLabel(props.sourceName, props.targetName) ??
    "Kim jest druga osoba dla pierwszej",
);

const backwardLabel = computed(
  () =>
    arrowLabel(props.targetName, props.sourceName) ??
    "Kim jest pierwsza osoba dla drugiej",
);

/** What the vocabulary makes of whatever has been typed on the other side.
 *
 * Dropped once the reverse already says one of them - the chips are there to
 * save the typing, not to argue with a word somebody chose.
 */
const suggestions = computed(() => {
  if (!wantsBothSides.value) return [];
  const offered = reverseRelationSuggestions(details.value.name);
  return offered.filter((option) => option !== details.value.reverse_name);
});

const reverseHint = computed(() => {
  if (details.value.reverse_name) return undefined;
  if (isSymmetricRelation(details.value.name)) {
    return "To powiązanie zwykle brzmi tak samo w obie strony.";
  }
  return undefined;
});

const nameLabel = computed(() => {
  if (props.realType === "employed") return "Stanowisko / rola";
  if (wantsElection.value) return "Nazwa wyborów";
  return "Nazwa powiązania";
});

const namePlaceholder = computed(() =>
  props.realType === "employed" ? "np. prezes zarządu" : "",
);
</script>
