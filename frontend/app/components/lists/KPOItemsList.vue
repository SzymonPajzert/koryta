<template>
  <v-card width="100%">
    <v-card-title>
      <v-row>
        <v-spacer />
        <v-col v-if="numberOfScores != ''">
          <span class="pa-0 ma-2"> Dzięki za {{ numberOfScores }}!! </span>
        </v-col>
        <v-spacer />
        <v-col>
          <v-btn
            color="primary"
            :variant="filter == 'voted' ? 'flat' : 'outlined'"
            :active="filter == 'voted'"
            @click="set('voted')"
          >
            Tylko zagłosowane
          </v-btn>
        </v-col>
        <v-col>
          <v-btn
            color="primary"
            :variant="filter == 'unvoted' ? 'flat' : 'outlined'"
            :active="filter == 'unvoted'"
            @click="set('unvoted')"
          >
            Tylko niewidziane
          </v-btn>
        </v-col>
        <v-col cols="12">
          <v-text-field
            v-model="filterText"
            append-inner-icon="mdi-magnify"
            density="compact"
            label="Szukaj projektów"
            variant="solo"
            hide-details
            single-line
            bg-color="white"
            autocomplete="off"
          />
        </v-col>
      </v-row>
    </v-card-title>
  </v-card>

  <v-list v-list lines="two" width="100%" style="display: flex; height: 1000px">
    <v-virtual-scroll :items="filteredSubmissions">
      <template #default="{ item: submission }">
        <KPOItem
          :submission="submission"
          :score="toRef(scores, submission.id)"
        />
      </template>
    </v-virtual-scroll>
  </v-list>
</template>

<script setup lang="ts">
import { useKPO } from "@/composables/kpo";

type filterType = "unvoted" | "voted";

const { submissions, scores } = useKPO();
const filter = ref<filterType | undefined>();
const filterText = ref<string>("");

function set(value: filterType) {
  if (filter.value == value) {
    filter.value = undefined;
    return;
  }
  filter.value = value;
  console.log(filter.value);
}

const numberOfScores = computed(() => {
  const n = Object.values(scores.value ?? {}).filter((n) => n != 0).length;
  if (n == 0) {
    return "";
  }
  if (n == 1) {
    return "1 głos";
  }
  if (n > 1 && n < 5) {
    return n + " głosy";
  }
  return n + " głosów";
});

const filteredSubmissions = computed(() => {
  const filterTex = filterText.value.toLowerCase();
  return submissions.value.filter((submission) => {
    let textFilter = true;
    if (filterText.value != "") {
      textFilter =
        submission.title.toLowerCase().includes(filterTex) ||
        submission.content.toLowerCase().includes(filterTex);
    }

    let scoreFilter = true;
    const score = scores.value[submission.id] ?? 0;
    if (filter.value == "voted") {
      scoreFilter = score != 0;
    }
    if (filter.value == "unvoted") {
      scoreFilter = score == 0;
    }
    return scoreFilter && textFilter;
  });
});
</script>
