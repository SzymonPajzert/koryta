<template>
  <v-container class="kategoryzacja-container">
    <div class="d-flex align-center mb-4">
      <v-btn
        variant="text"
        :prepend-icon="mdiArrowLeft"
        to="/ekstrakcje"
        class="me-2"
      >
        Powrót
      </v-btn>
      <h1 class="text-h5">Kategoryzuj fakty</h1>
    </div>

    <div v-if="pending" class="d-flex justify-center py-8">
      <v-progress-circular indeterminate color="primary" size="48" />
    </div>

    <div v-else-if="sortedFacts.length === 0" class="py-8 text-center">
      <v-alert type="info" variant="tonal">
        Brak faktów do kategoryzacji.
      </v-alert>
    </div>

    <template v-else>
      <!-- Progress counter -->
      <div class="text-center mb-4 text-body-2 text-medium-emphasis">
        {{ currentIndex + 1 }} / {{ sortedFacts.length }} faktów
      </div>

      <!-- Swipe card area -->
      <div class="swipe-area mx-auto">
        <ExtractionSwipeCard
          v-if="currentFact"
          :key="currentFact.id ?? currentIndex"
          :fact="currentFact"
          @swiped="onSwiped"
        />

        <div v-else class="text-center py-8">
          <v-icon size="64" color="success" class="mb-4">{{
            mdiCheckAll
          }}</v-icon>
          <div class="text-h6">Wszystkie fakty przejrzane!</div>
          <v-btn class="mt-4" color="primary" variant="tonal" to="/ekstrakcje">
            Wróć do listy
          </v-btn>
        </div>
      </div>

      <!-- Desktop fallback buttons -->
      <div
        v-if="currentFact"
        class="d-flex justify-center align-center ga-4 mt-6"
      >
        <v-btn
          color="error"
          variant="tonal"
          size="large"
          :prepend-icon="mdiCloseCircleOutline"
          @click="onSwiped('left')"
        >
          Niepoprawny
        </v-btn>
        <v-btn
          color="success"
          variant="tonal"
          size="large"
          :append-icon="mdiCheckCircleOutline"
          @click="onSwiped('right')"
        >
          Poprawny
        </v-btn>
      </div>
    </template>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import {
  mdiArrowLeft,
  mdiCheckAll,
  mdiCheckCircleOutline,
  mdiCloseCircleOutline,
} from "@mdi/js";
import { useExtractions } from "~/composables/extractions";
import { useVotes } from "~/composables/votes";
import type { ExtractionFact } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});
useHead({
  title: "Kategoryzacja faktów - koryta.pl",
});

const { data, pending } = useExtractions();

// Track which facts the user has voted on in this session
const votedIds = ref(new Set<string>());
const currentIndex = ref(0);

const sortedFacts = computed<ExtractionFact[]>(() => {
  const response = data.value;
  if (!response?.facts) return [];

  // Only include facts with IDs (required for voting)
  const withIds = response.facts.filter((f) => f.id);

  // Sort: unvoted first, then voted
  return [...withIds].sort((a, b) => {
    const aVoted = votedIds.value.has(a.id!);
    const bVoted = votedIds.value.has(b.id!);
    if (aVoted === bVoted) return 0;
    return aVoted ? 1 : -1;
  });
});

const currentFact = computed<ExtractionFact | undefined>(
  () => sortedFacts.value[currentIndex.value],
);

function onSwiped(direction: "left" | "right") {
  const fact = currentFact.value;
  if (!fact?.id) return;

  // Cast vote: right = correct (+1), left = incorrect (-1)
  const { castVote } = useVotes(fact.id, "correct");
  const value = direction === "right" ? 1 : -1;
  castVote(value);

  votedIds.value.add(fact.id);

  // Advance to next fact
  if (currentIndex.value < sortedFacts.value.length - 1) {
    currentIndex.value++;
  } else {
    // All done — move past the end so "all done" message shows
    currentIndex.value = sortedFacts.value.length;
  }
}
</script>

<style scoped>
.kategoryzacja-container {
  max-width: 600px;
}

.swipe-area {
  max-width: 480px;
}
</style>
