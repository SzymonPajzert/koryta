<template>
  <v-list-item
    :href="
      'https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/ogloszenia/' +
      submission.id
    "
    target="_blank"
    variant="outlined"
    color="deep-purple-lighten-4"
    class="ma-2"
  >
    <div class="font-weight-bold list-title">{{ submission.title }}</div>
    <div class="text-body-2">
      {{ submission.content }}
    </div>

    <!-- Action buttons in the append slot for clean alignment -->
    <template v-slot:append>
      <div class="d-flex flex-sm-column ga-1">
        <span v-if="score.value && score.value > 0" class="text-orange-darken-1">
          {{  "X" + "D".repeat(score.value ?? 0) }}
        </span>
        <span v-else-if="score.value && score.value < 0">
          {{ score }}
        </span>
      </div>
      <div class="d-flex flex-sm-column ga-1">
        <v-btn
          size="small"
          icon="mdi-arrow-up-bold"
          variant="text"
          @click.prevent="addValue(1)"
          title="Dodaj"
        ></v-btn>
        <v-btn
          size="small"
          icon="mdi-arrow-down-bold"
          variant="text"
          @click.prevent="addValue(-1)"
          title="Zwiększ"
        ></v-btn>
      </div>
    </template>
  </v-list-item>

  <!-- Expansion area for the editing form -->
  <v-expand-transition> </v-expand-transition>
</template>

<script setup lang="ts">
import { type Submission } from "@/composables/kpo";
import { db } from "@/firebase";
import { ref as dbRef, set } from "firebase/database";
import { useAuthState } from "@/composables/auth";
import router from "@/router";
import { type Ref } from "vue";

const { submission, score } = defineProps<{
  submission: Submission;
  score: Ref<number | undefined>;
}>();

const { user } = useAuthState();

function addValue(value: number) {
  score.value = (score.value ?? 0) + value;

  if(!user.value?.uid) {
    router.push("/login");
    return;
  }

  set(
    dbRef(db, `/user/${user.value?.uid}/kpo/scores/${submission.id}`),
    score.value,
  );
}
</script>

<style scoped>
.list-title {
  color: #2E7225;
}
</style>
