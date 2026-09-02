<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-2">Połączenia</h1>
    <p class="text-body-1 text-medium-emphasis mb-4">
      Pogrupuj 16 osób w cztery czwórki. Każdą grupę łączy jedno: partia, rok
      startu w wyborach, region albo miejsce pracy. Nie znasz tych osób?
      Świetnie — każdy kafelek prowadzi do profilu w bazie, a szukanie wskazówek
      to część zabawy.
    </p>

    <v-row v-if="pending">
      <v-col cols="12" class="d-flex justify-center my-12">
        <v-progress-circular indeterminate color="primary" size="64" />
      </v-col>
    </v-row>

    <v-alert
      v-else-if="error || !puzzle"
      type="error"
      text="Nie udało się pobrać dzisiejszej układanki. Spróbuj ponownie później."
    />

    <template v-else>
      <!-- Solved (or, after the game ends, all) groups -->
      <v-sheet
        v-for="group in visibleGroups"
        :key="group.kind"
        :style="{ backgroundColor: connectionsGroupStyles[group.kind].color }"
        class="pa-3 mb-2 text-center"
        rounded="lg"
      >
        <div class="font-weight-bold">
          {{ group.label }}
          <span v-if="finished && !isSolved(group)">(nieodgadnięte)</span>
        </div>
        <div class="text-body-2">
          <template v-for="(id, index) in group.personIds" :key="id">
            <NuxtLink
              :to="profileUrl(id)"
              target="_blank"
              class="text-decoration-none text-black"
            >
              {{ nameOf(id) }}
            </NuxtLink>
            <span v-if="index < group.personIds.length - 1">, </span>
          </template>
        </div>
      </v-sheet>

      <!-- Remaining tiles -->
      <v-row v-if="!finished" dense class="mt-1">
        <v-col v-for="id in remainingIds" :key="id" cols="3">
          <v-card
            :color="selected.includes(id) ? 'primary' : undefined"
            class="tile d-flex align-center justify-center pa-1 px-2 text-center position-relative"
            height="100%"
            min-height="76"
            hover
            @click="toggle(id)"
          >
            <span class="text-caption text-sm-body-2 font-weight-medium">
              {{ nameOf(id) }}
            </span>
            <v-btn
              :href="profileUrl(id)"
              target="_blank"
              :icon="mdiOpenInNew"
              size="x-small"
              variant="text"
              density="comfortable"
              class="tile-link"
              :aria-label="`Profil: ${nameOf(id)}`"
              @click.stop
            />
          </v-card>
        </v-col>
      </v-row>

      <!-- Controls -->
      <div
        v-if="!finished"
        class="d-flex align-center justify-center flex-wrap ga-2 mt-4"
      >
        <span class="text-body-2 text-medium-emphasis me-2">
          Pozostałe próby:
          <v-icon
            v-for="dot in connectionsMaxMistakes - mistakes"
            :key="dot"
            :icon="mdiCircle"
            size="x-small"
          />
        </span>
        <v-btn variant="outlined" :prepend-icon="mdiShuffle" @click="reshuffle">
          Przetasuj
        </v-btn>
        <v-btn
          variant="outlined"
          :disabled="selected.length === 0"
          @click="selected = []"
        >
          Wyczyść
        </v-btn>
        <v-btn
          color="primary"
          :disabled="selected.length !== 4"
          @click="submitGuess"
        >
          Sprawdź
        </v-btn>
      </div>

      <!-- Result -->
      <v-card v-if="finished" class="mt-6 pa-4 text-center" variant="outlined">
        <h2 class="text-h6 mb-2">
          {{
            won
              ? "Brawo! Wszystkie koryta połączone 🐷"
              : "Tym razem się nie udało"
          }}
        </h2>
        <pre class="emoji-grid mb-4">{{ emojiGrid }}</pre>
        <v-btn
          color="primary"
          :prepend-icon="mdiShareVariant"
          @click="shareResult"
        >
          Udostępnij wynik
        </v-btn>
        <p class="text-body-2 text-medium-emphasis mt-4 mb-0">
          Nowa układanka codziennie o północy. Znasz powiązania, których u nas
          brakuje?
        </p>
        <v-btn variant="text" color="primary" to="/pomoc">
          Dodaj je do bazy
        </v-btn>
      </v-card>
    </template>

    <v-snackbar v-model="snackbar" :timeout="3000">{{
      snackbarText
    }}</v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { mdiCircle, mdiOpenInNew, mdiShareVariant, mdiShuffle } from "@mdi/js";
import {
  connectionsGroupStyles,
  connectionsMaxMistakes,
  type ConnectionsGroup,
  type ConnectionsPuzzle,
} from "~~/shared/games/connections";
import { generateEntityUrl } from "~/composables/slugs";

definePageMeta({
  title: "Połączenia",
  layout: "gry",
  fullWidth: true,
});

const today = new Date().toLocaleDateString("en-CA", {
  timeZone: "Europe/Warsaw",
});

const {
  data: puzzle,
  pending,
  error,
} = await useFetch<ConnectionsPuzzle>("/api/games/connections", {
  query: { date: today },
});

const storageKey = "koryta:gry:polaczenia";
const selected = ref<string[]>([]);
const guesses = ref<string[][]>([]);
const displayIds = ref<string[]>([]);
const snackbar = ref(false);
const snackbarText = ref("");

const nameById = computed(
  () => new Map(puzzle.value?.people.map((tile) => [tile.id, tile.name])),
);
const groupByPersonId = computed(() => {
  const map = new Map<string, ConnectionsGroup>();
  for (const group of puzzle.value?.groups ?? []) {
    for (const id of group.personIds) map.set(id, group);
  }
  return map;
});

function nameOf(id: string): string {
  return nameById.value.get(id) ?? "";
}

function profileUrl(id: string): string {
  return generateEntityUrl("person", id, nameOf(id));
}

function sameMembers(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function isCorrectGuess(guess: string[]): boolean {
  return (puzzle.value?.groups ?? []).some((group) =>
    sameMembers(group.personIds, guess),
  );
}

const solvedGroups = computed(() =>
  guesses.value.flatMap(
    (guess) =>
      (puzzle.value?.groups ?? []).filter((group) =>
        sameMembers(group.personIds, guess),
      ) ?? [],
  ),
);
const mistakes = computed(
  () => guesses.value.filter((guess) => !isCorrectGuess(guess)).length,
);
const won = computed(() => solvedGroups.value.length === 4);
const lost = computed(() => mistakes.value >= connectionsMaxMistakes);
const finished = computed(() => won.value || lost.value);

function isSolved(group: ConnectionsGroup): boolean {
  return solvedGroups.value.includes(group);
}

/** While playing: solved groups in solve order. After the game: all groups. */
const visibleGroups = computed(() => {
  if (!finished.value) return solvedGroups.value;
  return [
    ...solvedGroups.value,
    ...(puzzle.value?.groups ?? []).filter((group) => !isSolved(group)),
  ];
});

const remainingIds = computed(() => {
  const solvedIds = new Set(
    solvedGroups.value.flatMap((group) => group.personIds),
  );
  return displayIds.value.filter((id) => !solvedIds.has(id));
});

function toggle(id: string) {
  if (selected.value.includes(id)) {
    selected.value = selected.value.filter((other) => other !== id);
  } else if (selected.value.length < 4) {
    selected.value = [...selected.value, id];
  }
}

function reshuffle() {
  displayIds.value = [...displayIds.value].sort(() => Math.random() - 0.5);
}

function notify(text: string) {
  snackbarText.value = text;
  snackbar.value = true;
}

function submitGuess() {
  const guess = [...selected.value];
  if (guesses.value.some((previous) => sameMembers(previous, guess))) {
    notify("Tę kombinację już sprawdzałeś.");
    return;
  }
  guesses.value = [...guesses.value, guess];
  if (isCorrectGuess(guess)) {
    selected.value = [];
    return;
  }
  const closeCall = (puzzle.value?.groups ?? []).some(
    (group) => guess.filter((id) => group.personIds.includes(id)).length === 3,
  );
  if (closeCall && !lost.value) notify("Blisko! Trzy osoby pasują do siebie.");
}

const emojiGrid = computed(() =>
  guesses.value
    .map((guess) =>
      guess
        .map((id) => {
          const group = groupByPersonId.value.get(id);
          return group ? connectionsGroupStyles[group.kind].emoji : "⬜";
        })
        .join(""),
    )
    .join("\n"),
);

async function shareResult() {
  const outcome = won.value
    ? `${guesses.value.length}/${4 + connectionsMaxMistakes - 1} prób`
    : "bez rozwiązania";
  const text = `Połączenia koryta.pl #${puzzle.value?.number} — ${outcome}\n${emojiGrid.value}\nhttps://koryta.pl/gry/polaczenia`;
  // Despite the DOM types, navigator.share is missing on desktop browsers.
  const canShare = "share" in navigator;
  try {
    if (canShare) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    notify("Wynik skopiowany do schowka.");
  } catch {
    notify("Nie udało się udostępnić wyniku.");
  }
}

watch(
  puzzle,
  (value) => {
    displayIds.value = value?.people.map((tile) => tile.id) ?? [];
  },
  { immediate: true },
);

onMounted(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (stored?.date !== today || !Array.isArray(stored.guesses)) return;
    const knownIds = nameById.value;
    guesses.value = stored.guesses.filter(
      (guess: unknown) =>
        Array.isArray(guess) &&
        guess.length === 4 &&
        guess.every((id) => typeof id === "string" && knownIds.has(id)),
    );
  } catch {
    // Corrupted state — start fresh.
  }
});

watch(guesses, (value) => {
  if (import.meta.client) {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ date: today, guesses: value }),
    );
  }
});
</script>

<style scoped>
.tile {
  cursor: pointer;
  user-select: none;
}
.tile-link {
  position: absolute;
  top: 0;
  right: 0;
}
.emoji-grid {
  font-family: inherit;
  font-size: 1.5rem;
  line-height: 1.9rem;
}
</style>
