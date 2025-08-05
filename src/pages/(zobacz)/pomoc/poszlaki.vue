<template>
  <!-- <v-card>
    TODO Znajdź ludzi z takich organizacji jak 0000336643. Nie iteresują mnie, ale algorytm powienien je proponować bo duo ludzi wychodzi z nich.
    TODO List active companies that the person is a part of, filter on them
    TODO: Yellow if person is suggested (because in DB) and put on to
    TODO: Rodziel punkty jeśli są między radę nadzorczą i zarząd (ale chyba nie jest to warte)
  </v-card> -->

  <v-expand-transition>
    <v-list v-if="showScores">
      <v-list-item v-for="([krs, companyScore], _) in companiesSorted">
        {{ companyScore.name }} ({{ companyScore.score }} / {{ krs }})
      </v-list-item>
    </v-list>
  </v-expand-transition>

  <v-card width="100%" align="center" class="mt-3">
    <v-card-title>
      Znalazłem {{ Object.keys(peopleOrdered).length }} osób
    </v-card-title>
    <v-card-text>
      {{ visited }} przejrzanych
      <br />
      {{ toAdd }} do dodania
      <br />
      {{ toCheck }} do sprawdzenia
      <br />
      {{ Object.keys(people).length }} łącznie
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn @click="showScores = !showScores">Kolejność organizacji</v-btn>
      <v-btn @click="sortKeys">Sortuj</v-btn>
    </v-card-actions>
  </v-card>

  <v-divider />

  <v-list lines="two" width="100%">
    <ClueListItem
      v-for="[index, person] in peopleOrdered"
      :key="index"
      :person="person"
      :companies="personCompanies[index]"
    />
  </v-list>
</template>

<script setup lang="ts">
import { type PersonRejestr } from "@/composables/model";
import { createEntityStore } from "@/stores/entity";
import { toNumber, useCompanyScore } from "@/composables/entities/companyScore";
import ClueListItem from "@/components/lists/ClueListItem.vue";

const usePeopleStore = createEntityStore("external/rejestr-io/person");
const peopleStore = usePeopleStore();
const { entities: people } = storeToRefs(peopleStore);

const showScores = ref(false);
const firstChance = ref(2);
const ignoreSuccess = ref(3);

const { scores, personScore, personCompanies } = useCompanyScore(
  firstChance,
  ignoreSuccess,
);
const companiesSorted = computed(() =>
  Object.entries(scores.value).sort(
    (a, b) => toNumber(b[1].score) - toNumber(a[1].score),
  ),
);

// Show only people that are active
// TODO active only in selected companies
const peopleFiltered = computed(() => {
  const activePeopleKey = new Set();
  Object.entries(personCompanies.value).forEach(([key, companies]) => {
    if (companies.filter((c) => c.state === "aktualne").length > 0) {
      activePeopleKey.add(key);
    }
  });

  return Object.fromEntries(
    Object.entries(people.value).filter(([key, _]: [string, PersonRejestr]) =>
      activePeopleKey.has(key),
    ),
  );
});

const keys = ref<string[]>([]);
watch(peopleFiltered, (value, oldValue) => {
  const newKeys = Object.keys(value);
  const oldKeys = Object.keys(oldValue);
  if (newKeys.length === oldKeys.length) {
    return;
  }
  keys.value = Object.keys(value);
});

function getScore(person?: PersonRejestr): number {
  if (!person) return 0;
  if (person.status === "unknown") {
    return -0.5;
  }
  return person.score ?? 0;
}

const sortKeys = function () {
  keys.value.sort((a, b) => {
    const bVal = getScore(peopleFiltered.value[b]);
    const aVal = getScore(peopleFiltered.value[a]);
    if (bVal == 0 && aVal == 0) {
      return personScore.value[b] - personScore.value[a];
    }
    return bVal - aVal;
  });
};

const peopleOrdered = computed<[string, PersonRejestr][]>(() => {
  const filtered = peopleFiltered.value;
  return keys.value.map((key) => [key, filtered[key]]);
});

const visited = computed(
  () =>
    Object.values(peopleOrdered.value).filter(([_, p]) => (p.score ?? 0) != 0)
      .length,
);
const toAdd = computed(
  () =>
    Object.values(peopleOrdered.value).filter(([_, p]) => (p.score ?? 0) > 0)
      .length,
);
const toCheck = computed(
  () =>
    Object.values(peopleOrdered.value).filter(([_, p]) => (p.score ?? 0) == 0)
      .length,
);
</script>
