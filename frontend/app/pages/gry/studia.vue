<template>
  <GamesGameShell
    :slug="studiaSlug"
    :number="puzzle?.number"
    :pending="pending"
    :failed="!!error || !puzzle"
    :finished="solved"
    :share-text="shareText"
  >
    <template #lead>
      Przed Tobą czyjeś CV — praca i starty w wyborach, bez nazwisk i nazw
      pracodawców. Zgadnij, co ta osoba skończyła. Po każdej próbie powiemy,
      które to miejsce w rankingu bliskości; zgadujesz do skutku.
    </template>

    <template v-if="puzzle">
      <v-card variant="outlined" class="pa-4 mb-4">
        <h2 class="text-subtitle-1 font-weight-bold mb-2">Anonimowe CV</h2>
        <v-timeline side="end" density="compact" truncate-line="both">
          <v-timeline-item
            v-for="(entry, index) in puzzle.cv"
            :key="index"
            :dot-color="entry.kind === 'wybory' ? 'secondary' : 'primary'"
            size="x-small"
          >
            <div class="text-body-2 font-weight-bold">{{ entry.what }}</div>
            <div class="text-caption text-medium-emphasis">
              <span v-if="entry.role">{{ entry.role }} · </span>
              <span>{{ yearsLabel(entry) }}</span>
              <span v-if="entry.party"> · {{ entry.party }}</span>
            </div>
          </v-timeline-item>
        </v-timeline>
      </v-card>

      <v-card v-if="!solved" variant="outlined" class="pa-4">
        <v-autocomplete
          v-model="choice"
          :items="puzzle.terms"
          label="Co ta osoba skończyła?"
          placeholder="np. stolarz, magister prawa, duchowny prawosławny"
          :disabled="checking"
          auto-select-first
          density="comfortable"
          hide-details
          data-testid="studia-input"
        />
        <v-btn
          class="mt-3"
          color="primary"
          variant="flat"
          :loading="checking"
          :disabled="!choice"
          data-testid="studia-submit"
          @click="check"
        >
          Sprawdź
        </v-btn>
      </v-card>

      <v-list v-if="results.length" class="mt-4" density="compact">
        <v-list-item
          v-for="result in ordered"
          :key="result.term"
          :data-testid="`studia-guess-${result.term}`"
        >
          <template #prepend>
            <span class="rank text-body-2 font-weight-bold mr-3">
              #{{ result.rank }}
            </span>
          </template>
          <v-list-item-title>{{ result.term }}</v-list-item-title>
          <template #append>
            <span class="text-caption text-medium-emphasis">
              {{ result.temperature }}
            </span>
          </template>
        </v-list-item>
      </v-list>
    </template>

    <template #result>
      <h2 class="text-h5 font-weight-bold mb-1">
        {{ answer?.term }}
      </h2>
      <p class="text-body-2 text-medium-emphasis mb-2">
        Trafione po {{ results.length }}
        {{ results.length === 1 ? "próbie" : "próbach" }}. To CV należy do:
        <NuxtLink v-if="profileUrl" :to="profileUrl">
          {{ answer?.personName }}
        </NuxtLink>
        <span v-else>{{ answer?.personName }}</span>
      </p>
    </template>
  </GamesGameShell>
</template>

<script lang="ts" setup>
import {
  studiaSlug,
  studiaSquares,
  type StudiaCvEntry,
  type StudiaGuessResult,
  type StudiaPuzzle,
} from "~~/shared/games/studia";
import {
  useDailyPuzzle,
  useGameProgress,
  gameShareUrl,
} from "~/composables/games";
import { gameEntry } from "~~/shared/games/registry";
import { generateEntityUrl } from "~/composables/slugs";

definePageMeta({
  title: "Po jakich studiach?",
  layout: "gry",
  fullWidth: true,
});

const { day, puzzle, pending, error } =
  await useDailyPuzzle<StudiaPuzzle>("/api/games/studia");

const results = useGameProgress<StudiaGuessResult[]>(
  studiaSlug,
  day,
  () => [],
  (stored) =>
    Array.isArray(stored) &&
    stored.every(
      (item) =>
        item && typeof item === "object" && typeof item.rank === "number",
    )
      ? (stored as StudiaGuessResult[])
      : null,
);

const choice = ref<string | null>(null);
const checking = ref(false);

const answer = computed(() => results.value.find((result) => result.solved));
const solved = computed(() => !!answer.value);

/** Closest first, so the top of the list is the best the player has done -
 * which is the number they are actually playing against. */
const ordered = computed(() =>
  [...results.value].sort((a, b) => a.rank - b.rank),
);

const profileUrl = computed(() => {
  const found = answer.value;
  if (!found?.personId || !found.personName) return undefined;
  return generateEntityUrl("person", found.personId, found.personName);
});

async function check() {
  const term = choice.value;
  if (!term || checking.value) return;
  if (results.value.some((result) => result.term === term)) {
    choice.value = null;
    return;
  }
  checking.value = true;
  try {
    const result = await $fetch<StudiaGuessResult>("/api/games/studia/guess", {
      query: { date: day, term },
    });
    results.value = [...results.value, result];
    choice.value = null;
  } catch {
    // A term the server does not know, or a day that has since stopped
    // generating. Either way there is nothing to add to the list.
  } finally {
    checking.value = false;
  }
}

function yearsLabel(entry: StudiaCvEntry): string {
  if (entry.from && entry.to && entry.from !== entry.to) {
    return `${entry.from}–${entry.to}`;
  }
  return entry.from ?? entry.to ?? "bez dat";
}

const shareText = computed(() => {
  if (!solved.value || !puzzle.value) return undefined;
  return (
    `Po jakich studiach? koryta.pl #${puzzle.value.number} — ` +
    `${results.value.length} ${results.value.length === 1 ? "próba" : "prób"}\n` +
    `${studiaSquares(results.value.length)}\n${gameShareUrl(studiaSlug)}`
  );
});

useSeoMeta({
  title: "Po jakich studiach? — gra koryta.pl",
  description: gameEntry(studiaSlug).tagline,
});
</script>

<style scoped>
/* Fixed width so the ranks line up as a column - the list is read down the
   numbers, not across the terms. */
.rank {
  display: inline-block;
  min-width: 4ch;
  text-align: right;
}
</style>
