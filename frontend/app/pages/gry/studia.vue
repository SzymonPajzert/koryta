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
        <!-- The list is a thousand terms and this is played on a phone, so
             nothing is offered until the player has typed two letters: the
             menu would otherwise mount the whole vocabulary on focus. It is a
             search box, not a menu - see `matches`. -->
        <v-autocomplete
          v-model="choice"
          v-model:search="query"
          :items="matches"
          :custom-filter="() => true"
          label="Co ta osoba skończyła?"
          placeholder="np. stolarz, magister prawa, duchowny prawosławny"
          :no-data-text="
            query.trim().length < 2
              ? 'Wpisz co najmniej dwie litery'
              : 'Nie znam takiego kierunku'
          "
          :disabled="checking"
          auto-select-first
          density="comfortable"
          hide-details
          data-testid="studia-input"
        />
        <v-btn
          class="mt-3 w-100 w-sm-auto"
          color="primary"
          size="large"
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
        <!-- The term wraps and the verdict sits under it rather than beside
             it: a v-list-item `#append` holds its width and squeezes the title
             instead, and "magister inżynier ochrony środowiska" against
             "bardzo blisko" leaves nothing legible on a 375px screen. -->
        <v-list-item
          v-for="result in ordered"
          :key="result.term"
          :class="{ 'bg-surface-light': result.term === latest }"
          :data-testid="`studia-guess-${result.term}`"
        >
          <template #prepend>
            <span class="rank text-body-2 font-weight-bold mr-3">
              #{{ result.rank }}
            </span>
          </template>
          <v-list-item-title class="text-wrap">
            {{ result.term }}
          </v-list-item-title>
          <v-list-item-subtitle class="d-flex align-center ga-2">
            <!-- The bar is the whole point of a Contexto rank: #180 means
                 nothing on its own and everything against the length of the
                 list. It fills from the cold end, so a guess that moves the
                 player closer visibly grows. -->
            <v-progress-linear
              :model-value="closeness(result)"
              :color="temperatureColor(result.temperature)"
              height="6"
              rounded
              class="closeness"
            />
            <span class="text-no-wrap">
              {{ result.temperature }} · {{ result.rank }} z {{ result.total }}
            </span>
          </v-list-item-subtitle>
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
const query = ref("");
const checking = ref(false);

/** What the autocomplete offers, which is deliberately nothing until there is
 * something to narrow.
 *
 * The vocabulary is ~1000 terms and `v-autocomplete` mounts a list item per
 * item the moment its menu opens, so binding the whole thing costs a thousand
 * DOM nodes on a phone to show a menu nobody scrolls. Filtering here rather
 * than leaving it to Vuetify also lets the match be a substring anywhere in
 * the term - "budow" finds "magister inżynier budownictwa" - which is how a
 * player who half-knows the answer actually types. `custom-filter` is stubbed
 * to true so Vuetify does not filter the result a second time, on the raw
 * search string, and throw away what this matched.
 */
const matches = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (needle.length < 2) return [];
  const terms = puzzle.value?.terms ?? [];
  return terms
    .filter((term) => term.toLowerCase().includes(needle))
    .slice(0, 40);
});

const answer = computed(() => results.value.find((result) => result.solved));
const solved = computed(() => !!answer.value);

/** Closest first, so the top of the list is the best the player has done -
 * which is the number they are actually playing against. */
const ordered = computed(() =>
  [...results.value].sort((a, b) => a.rank - b.rank),
);

/** The guess just made, which the ordering above has scattered somewhere into
 * the middle of the list. Highlighted so a player can find what they typed. */
const latest = computed(() => results.value.at(-1)?.term);

/** How full the bar is, in percent. Not `100 - rank/total`: the ranks a player
 * actually reaches are all near the top of a list this long, and a linear
 * scale would leave every one of them looking identically empty. The square
 * root spends the bar where the game is played - it reads about a third full
 * at the halfway mark and only fills over the last few dozen places. */
function closeness(result: StudiaGuessResult): number {
  const share = (result.rank - 1) / Math.max(result.total - 1, 1);
  return 100 * (1 - Math.sqrt(share));
}

/** Cold to warm. Vuetify's own theme colours rather than raw hex, so the scale
 * survives the dark theme. */
function temperatureColor(temperature: string): string {
  switch (temperature) {
    case "trafione":
      return "success";
    case "bardzo blisko":
      return "success";
    case "blisko":
      return "warning";
    case "ciepło":
      return "warning";
    case "chłodno":
      return "info";
    default:
      return "grey";
  }
}

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
    // Checked again on the way back, not only on the way out: the server
    // answers with the canonical term, so two spellings of one entry - a term
    // and somebody else's alias for it - arrive here as the same row. Counting
    // it twice would inflate the score and the share card.
    if (!results.value.some((stored) => stored.term === result.term)) {
      results.value = [...results.value, result];
    }
    choice.value = null;
    query.value = "";
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
  min-width: 5ch;
  text-align: right;
}

/* Wide enough to read as a scale and narrow enough to leave the verdict on one
   line at 375px, which is where this game is actually played. */
.closeness {
  max-width: 40%;
  min-width: 60px;
}
</style>
