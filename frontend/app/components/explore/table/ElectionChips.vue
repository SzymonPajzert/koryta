<template>
  <!-- One root, so the `.elections-cell` caps explore/Table.vue sets - 220px
       on a desktop, 185px inside the phone budget - still land on it: Vue
       stamps a child's root element with the parent's scope id as well as its
       own. The rules that reach *inside* a chip cannot travel that way, so
       they moved down here with the markup. -->
  <div v-if="elections?.length" class="elections-cell py-1">
    <v-chip
      v-for="(election, i) in elections"
      :key="i"
      size="small"
      class="mb-1"
      :class="{ 'bg-surface-sage election-matched': matches(election) }"
      variant="outlined"
    >
      <v-tooltip activator="parent" location="top" open-delay="200">
        <div v-if="election.location">{{ election.location }}</div>
        <div>
          {{
            getWojewodztwo(election.teryt)
              ? `woj. ${getWojewodztwo(election.teryt)}`
              : "Brak informacji o województwie"
          }}
        </div>
        <div v-if="election.committee">{{ election.committee }}</div>
        <div v-if="election.elected === true">Wybrany</div>
      </v-tooltip>
      <v-icon
        v-if="election.elected === true"
        :icon="mdiCheckCircle"
        size="14"
        class="mr-1 election-won"
        aria-label="wybrany"
      />
      <span v-if="election.year" class="font-weight-bold mr-1">
        {{ election.year }}
      </span>
      <span v-if="election.location" class="election-location">
        {{ election.location }}
      </span>
    </v-chip>
  </div>
</template>

<script setup lang="ts">
/** The elections a person stood in, as chips.
 *
 * Its own component because /eksploruj/tabela draws them as a column of their
 * own ("Wybory", desktop only) while /eksploruj/nowe keeps them inside the
 * merged history cell, and one block of markup cannot be rendered into two
 * data-table cells. Copying it into both slots would have left the tooltip -
 * which is where the committee name lives, and the whole reason this column is
 * narrow - to drift between the two copies. */
import { mdiCheckCircle } from "@mdi/js";
import type { ElectionRich, PersonRich } from "~~/shared/model";

const props = defineProps<{
  elections?: PersonRich["elections"];
  /** The page's election filter: the runs it matched are filled, so a row
   * that lists thirteen runs says which one put it in the table. */
  matched?: string[] | null;
}>();

/** Whether this run is in one of the elections the filter asked for. */
const matches = (election: ElectionRich) =>
  !!election.key && !!props.matched?.includes(election.key);

const terytToWojewodztwo: Record<string, string> = {
  "02": "dolnośląskie",
  "04": "kujawsko-pomorskie",
  "06": "lubelskie",
  "08": "lubuskie",
  "10": "łódzkie",
  "12": "małopolskie",
  "14": "mazowieckie",
  "16": "opolskie",
  "18": "podkarpackie",
  "20": "podlaskie",
  "22": "pomorskie",
  "24": "śląskie",
  "26": "świętokrzyskie",
  "28": "warmińsko-mazurskie",
  "30": "wielkopolskie",
  "32": "zachodniopomorskie",
};

const getWojewodztwo = (teryt?: string) => {
  if (!teryt || teryt.length < 2) return undefined;
  return terytToWojewodztwo[teryt.substring(0, 2)];
};
</script>

<style scoped>
.elections-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.elections-cell .v-chip {
  max-width: 100%;
}

/* The run the filter matched: the bar's sage, outline kept, a touch heavier -
 * filled without its outline it read as quieter than its neighbours, not
 * louder. */
.election-matched {
  font-weight: 500;
}

/* A recorded win, in the chip's own ink. */
.election-won {
  opacity: 0.85;
}

.elections-cell :deep(.v-chip__content) {
  min-width: 0;
}

/* A town name long enough to widen the column is cut instead - the full one is
 * in the tooltip above, next to the committee. */
.election-location {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
