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
    <template #append>
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
          title="Dodaj"
          size="small"
          icon="mdi-arrow-up-bold"
          variant="text"
          @click.prevent="addValue(1)"
        />
        <v-btn
          title="Zwiększ"
          size="small"
          icon="mdi-arrow-down-bold"
          variant="text"
          @click.prevent="addValue(-1)"
        />
      </div>
    </template>
  </v-list-item>
</template>

<script setup lang="ts">
import type { KPOSubmission as Submission } from "~~/shared/model";
import { ref as dbRef, update } from "firebase/database";
import { useAuthState } from "@/composables/auth";
import type { Ref } from "vue";

const { submission, score } = defineProps<{
  submission: Submission;
  score: Ref<number | undefined>;
}>();

const { user } = useAuthState();
const router = useRouter();
const db = useDatabase();

function addValue(value: number) {
  score.value = (score.value ?? 0) + value;
  const newScore = score.value;

  if (!user.value?.uid) {
    router.push("/login");
    return;
  }

  const userId = user.value.uid;
  const submissionId = submission.id;

  const updates: Record<string, number> = {};
  updates[`/user/${userId}/kpo/scores/${submissionId}`] = newScore;
  // TODO set this path for all the ones above
  updates[`/kpo_scores/${submissionId}/${userId}`] = newScore;

  // Use update() for atomic multi-path writes.
  update(dbRef(db), updates);
}
</script>

<style scoped>
.list-title {
  color: #2E7225;
}
</style>
