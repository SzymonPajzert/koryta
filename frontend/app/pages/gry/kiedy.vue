<template>
  <GamesGameShell
    :slug="kiedySlug"
    :number="puzzle?.number"
    :pending="pending"
    :failed="!!error || !puzzle"
    :finished="finished"
    :share-text="shareText"
  >
    <template #lead>
      Sześć prawdziwych zmian na stanowiskach — ktoś odszedł, ktoś przyszedł.
      Ustaw suwak na roku, w którym to się stało. Im bliżej, tym więcej punktów;
      pięć lat obok to zero.
    </template>

    <template v-if="puzzle">
      <div class="d-flex align-center justify-space-between mb-2">
        <span class="text-body-2 text-medium-emphasis">
          Runda {{ Math.min(round + 1, puzzle.swaps.length) }} z
          {{ puzzle.swaps.length }}
        </span>
        <span class="text-body-2 font-weight-bold" data-testid="kiedy-score">
          {{ score }} pkt
        </span>
      </div>

      <!-- The register's own card, drawn by the component a profile uses -
           with the terms blanked and nothing to click through to. -->
      <SuccessionChangeCard v-if="current" :change="currentCard!" />

      <v-card v-if="!finished" variant="outlined" class="pa-4 mt-3">
        <GamesYearSlider
          v-model="guess"
          :min="puzzle.firstYear"
          :max="puzzle.lastYear"
          :disabled="!!answered"
          :marks="marks"
        />

        <div v-if="answered" class="mt-4" data-testid="kiedy-verdict">
          <p class="text-body-1 mb-1">
            <strong>{{ answered.verdict }}</strong>
            Zmiana nastąpiła w {{ answered.answer }} r. — zdobywasz
            {{ answered.points }} pkt.
          </p>
          <!-- Full width under `sm`, its own width above: the one thing to
               tap on this screen should be under the thumb, not centred in a
               row of empty card. -->
          <v-btn
            class="w-100 w-sm-auto"
            color="primary"
            size="large"
            variant="flat"
            @click="next"
          >
            {{ round + 1 < puzzle.swaps.length ? "Następna zmiana" : "Wynik" }}
          </v-btn>
        </div>

        <v-btn
          v-else
          class="mt-4 w-100 w-sm-auto"
          color="primary"
          size="large"
          variant="flat"
          data-testid="kiedy-submit"
          @click="submit"
        >
          Obstawiam {{ guess }}
        </v-btn>
      </v-card>
    </template>

    <template #result>
      <h2 class="text-h5 font-weight-bold mb-1">
        {{ score }} / {{ maxScore }} punktów
      </h2>
      <p class="text-body-2 text-medium-emphasis mb-3">
        Cały dzień na jednej osi — tak wyglądały te sześć zmian.
      </p>

      <GamesYearSlider
        v-if="puzzle"
        v-model="guess"
        :min="puzzle.firstYear"
        :max="puzzle.lastYear"
        disabled
        :marks="marks"
      />

      <v-list class="mt-3" density="compact">
        <v-list-item
          v-for="(swap, index) in puzzle?.swaps ?? []"
          :key="swap.id"
          :title="`${swap.companyName} — ${swap.role}`"
          :subtitle="resultLine(index, swap)"
        >
          <template #prepend>
            <span class="mr-2">{{ squares[index] }}</span>
          </template>
        </v-list-item>
      </v-list>
    </template>
  </GamesGameShell>
</template>

<script lang="ts" setup>
import {
  kiedyPoints,
  kiedyMaxPoints,
  kiedySlug,
  kiedySquare,
  kiedyVerdict,
  type KiedyPuzzle,
  type KiedySwap,
} from "~~/shared/games/kiedy";
import { personSuccessionChanges } from "~/utils/succession";
import {
  useDailyPuzzle,
  useGameProgress,
  gameShareUrl,
} from "~/composables/games";
import { gameEntry } from "~~/shared/games/registry";

definePageMeta({
  title: "Kiedy?",
  layout: "gry",
  fullWidth: true,
});

const { day, puzzle, pending, error } =
  await useDailyPuzzle<KiedyPuzzle>("/api/games/kiedy");

/** What is kept between visits: the year answered for each round, in order.
 * The swaps themselves are refetched, so a day whose pool changed under a
 * player resumes against whatever it now holds - which is why the reviver
 * checks the shape and lets the length sort itself out. */
const guesses = useGameProgress<number[]>(
  kiedySlug,
  day,
  () => [],
  (stored) =>
    Array.isArray(stored) && stored.every((year) => typeof year === "number")
      ? (stored as number[])
      : null,
);

const swaps = computed<KiedySwap[]>(() => puzzle.value?.swaps ?? []);
const round = computed(() =>
  Math.min(guesses.value.length, swaps.value.length),
);
const current = computed<KiedySwap | undefined>(() => swaps.value[round.value]);
const finished = computed(
  () => swaps.value.length > 0 && guesses.value.length >= swaps.value.length,
);

/** The slider starts in the middle of the axis rather than at either end: an
 * end is a guess the player did not make, and it would score as one. */
const guess = ref(2012);
watch(
  puzzle,
  (value) => {
    if (value) guess.value = Math.round((value.firstYear + value.lastYear) / 2);
  },
  { immediate: true },
);

/** The round just answered, while its verdict is on screen. Held apart from
 * `guesses` so that resuming a half-played day does not re-open a verdict the
 * player already read and moved past. */
const answered = ref<{
  verdict: string;
  answer: number;
  points: number;
} | null>(null);

function submit() {
  const swap = current.value;
  if (!swap || answered.value) return;
  const points = kiedyPoints(guess.value, swap.answer);
  guesses.value = [...guesses.value, guess.value];
  answered.value = {
    verdict: kiedyVerdict(guess.value, swap.answer),
    answer: swap.answer,
    points,
  };
}

function next() {
  answered.value = null;
}

const score = computed(() =>
  guesses.value.reduce(
    (total, year, index) =>
      total +
      (swaps.value[index] ? kiedyPoints(year, swaps.value[index]!.answer) : 0),
    0,
  ),
);
const maxScore = computed(() => swaps.value.length * kiedyMaxPoints);

const squares = computed(() =>
  guesses.value.map((year, index) =>
    swaps.value[index] ? kiedySquare(year, swaps.value[index]!.answer) : "⬜",
  ),
);

/** The answered rounds as pins on the shared axis. Drawn at the true year, not
 * the guessed one: the strip is meant to be a picture of the day's handovers,
 * and the player's own misses are the grey ones beside them. */
const marks = computed(() =>
  guesses.value.flatMap((year, index) => {
    const swap = swaps.value[index];
    if (!swap) return [];
    return [
      {
        key: swap.id,
        year: swap.answer,
        missed: year !== swap.answer,
        title: `${swap.companyName}: ${swap.answer}`,
      },
    ];
  }),
);

/** The card the player is being asked about, built through the same view-model
 * a person's page uses - with the two terms blanked, because they are the
 * answer, and with no urls, because the pages behind them print it. */
const currentCard = computed(() => {
  const swap = current.value ?? swaps.value[swaps.value.length - 1];
  if (!swap) return undefined;
  const [card] = personSuccessionChanges(
    [
      {
        companyId: "",
        companyName: swap.companyName,
        role: swap.role,
        start: null,
        end: null,
        batchSize: swap.batchSize,
        predecessor: null,
        successor: {
          edgeId: swap.id,
          personId: "",
          personName: swap.joined.name,
          parties: swap.joined.parties,
          start: null,
          end: null,
          published: true,
          gapDays: swap.gapDays,
        },
      },
    ],
    { name: swap.left.name, parties: swap.left.parties },
  );
  if (!card) return undefined;
  return {
    ...card,
    companyUrl: undefined,
    from: { ...card.from, url: undefined, when: "kadencja ukryta" },
    to: { ...card.to, url: undefined, when: "kadencja ukryta" },
  };
});

function resultLine(index: number, swap: KiedySwap): string {
  const year = guesses.value[index];
  if (year === undefined) return "";
  return `${swap.left.name} → ${swap.joined.name} · ${swap.answer} (obstawiłeś ${year})`;
}

const shareText = computed(() => {
  if (!finished.value || !puzzle.value) return undefined;
  return (
    `Kiedy? koryta.pl #${puzzle.value.number} — ${score.value}/${maxScore.value}\n` +
    `${squares.value.join("")}\n${gameShareUrl(kiedySlug)}`
  );
});

useSeoMeta({
  title: `Kiedy? — gra koryta.pl`,
  description: gameEntry(kiedySlug).tagline,
});
</script>
