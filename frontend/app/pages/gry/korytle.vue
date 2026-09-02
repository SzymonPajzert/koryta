<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-2">Korytle</h1>
    <p class="text-body-1 text-medium-emphasis mb-4">
      Przed Tobą mozaika koryciarzy z jednego regionu Polski — podzielona według
      branż spółek, w których pracują, a kolorami według partii, z którymi są
      powiązani. Zgadnij, o który region chodzi. Po każdej próbie podpowiemy,
      jak daleko i w którym kierunku szukać. Masz
      {{ korytleMaxGuesses }} prób.
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
      <!-- Mosaic: columns are branże, colored blocks are parties -->
      <v-card variant="outlined" class="pa-3 mb-2">
        <div class="text-body-2 text-medium-emphasis mb-2">
          {{ puzzle.totalPeople }} koryciarzy w bazie dla tego regionu
        </div>
        <div class="mosaic d-flex ga-1">
          <div
            v-for="column in mosaicColumns"
            :key="column.branza"
            class="mosaic-col d-flex flex-column"
            :style="{ flexGrow: column.count }"
          >
            <div class="text-caption text-truncate" :title="column.branza">
              {{ column.branza }} ({{ column.count }})
            </div>
            <div class="d-flex flex-column flex-1-1" style="min-height: 0">
              <div
                v-for="cell in column.cells"
                :key="cell.party"
                class="mosaic-cell d-flex align-center justify-center"
                :style="{ flexGrow: cell.count, backgroundColor: cell.color }"
                :title="`${cell.party}: ${cell.count}`"
              >
                <span v-if="cell.count >= 2" class="mosaic-cell-label">
                  {{ cell.count }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-chip
            v-for="party in legendParties"
            :key="party"
            size="small"
            variant="flat"
            :style="{ backgroundColor: partyColor(party) }"
            class="text-white"
          >
            {{ party }}
          </v-chip>
        </div>
      </v-card>

      <!-- Guess input -->
      <div v-if="!finished" class="d-flex align-center ga-2 mt-4">
        <v-autocomplete
          v-model="selectedId"
          :items="availableOptions"
          item-title="name"
          item-value="id"
          label="Który to region?"
          placeholder="np. Kraków"
          hide-details
          density="comfortable"
          auto-select-first
        />
        <v-btn color="primary" :disabled="!selectedId" @click="submitGuess">
          Zgadnij
        </v-btn>
      </div>
      <div v-if="!finished" class="text-body-2 text-medium-emphasis mt-2">
        Pozostałe próby: {{ korytleMaxGuesses - guesses.length }}
      </div>

      <!-- Guess feedback -->
      <v-table v-if="guessRows.length > 0" density="compact" class="mt-4">
        <tbody>
          <tr v-for="row in guessRows" :key="row.id">
            <td>{{ row.name }}</td>
            <td class="text-no-wrap">
              {{ row.hit ? "🎯" : `${row.arrow} ~${row.distance} km` }}
            </td>
            <td class="text-no-wrap">{{ row.squares }} {{ row.percent }}%</td>
          </tr>
        </tbody>
      </v-table>

      <!-- Result -->
      <v-card v-if="finished" class="mt-6 pa-4" variant="outlined">
        <h2 class="text-h6 mb-2 text-center">
          {{
            won
              ? `Brawo! To ${puzzle.answer.name} 🐷`
              : `Szukanym regionem był: ${puzzle.answer.name}`
          }}
        </h2>
        <div class="text-center">
          <v-btn
            color="primary"
            :prepend-icon="mdiShareVariant"
            @click="shareResult"
          >
            Udostępnij wynik
          </v-btn>
          <v-btn
            variant="text"
            color="primary"
            :to="`/eksploruj/tabela?teryt=${puzzle.answer.teryt.replace(/\D/g, '')}`"
            class="ms-2"
          >
            Zobacz region w bazie
          </v-btn>
        </div>

        <h3 class="text-subtitle-1 font-weight-bold mt-6 mb-2">
          Koryciarze z mozaiki
        </h3>
        <div v-for="group in revealGroups" :key="group.branza" class="mb-3">
          <div class="text-body-2 font-weight-medium mb-1">
            {{ group.branza }}
          </div>
          <div class="d-flex flex-wrap ga-1">
            <v-chip
              v-for="person in group.people"
              :key="person.id"
              size="small"
              variant="outlined"
              :href="profileUrl(person)"
              target="_blank"
              :title="`${person.company}${person.party ? ` · ${person.party}` : ''}`"
            >
              <span
                class="party-dot me-1"
                :style="{ backgroundColor: partyColor(person.party) }"
              />
              {{ person.name }}
            </v-chip>
          </div>
        </div>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Nowa układanka codziennie o północy. Znasz koryciarzy, których u nas
          brakuje?
        </p>
        <v-btn variant="text" color="primary" to="/pomoc">
          Dodaj ich do bazy
        </v-btn>
      </v-card>
    </template>

    <v-snackbar v-model="snackbar" :timeout="3000">{{
      snackbarText
    }}</v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { mdiShareVariant } from "@mdi/js";
import { partyColors } from "~~/shared/misc";
import {
  bearingDeg,
  directionArrow,
  haversineKm,
  korytleMaxGuesses,
  korytleNoParty,
  proximityPercent,
  proximitySquares,
  terytToPowiat,
  type KorytlePersonReveal,
  type KorytlePuzzle,
} from "~~/shared/games/korytle";
import { generateEntityUrl } from "~/composables/slugs";

definePageMeta({
  title: "Korytle",
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
} = await useFetch<KorytlePuzzle>("/api/games/korytle", {
  query: { date: today },
});

const storageKey = "koryta:gry:korytle";
const selectedId = ref<string | null>(null);
const guesses = ref<string[]>([]);
const snackbar = ref(false);
const snackbarText = ref("");

const fallbackPartyColor = "#9e9e9e";

function partyColor(party?: string): string {
  return (party && partyColors[party]) || fallbackPartyColor;
}

const optionById = computed(
  () => new Map(puzzle.value?.options.map((option) => [option.id, option])),
);

const mosaicColumns = computed(() => {
  const columns = new Map<
    string,
    {
      branza: string;
      count: number;
      cells: { party: string; count: number; color: string }[];
    }
  >();
  for (const cell of puzzle.value?.cells ?? []) {
    if (!columns.has(cell.branza)) {
      columns.set(cell.branza, { branza: cell.branza, count: 0, cells: [] });
    }
    const column = columns.get(cell.branza)!;
    column.count += cell.count;
    column.cells.push({
      party: cell.party,
      count: cell.count,
      color: partyColor(cell.party === korytleNoParty ? undefined : cell.party),
    });
  }
  return [...columns.values()].sort((a, b) => b.count - a.count);
});

const legendParties = computed(() => {
  const parties = new Set(
    (puzzle.value?.cells ?? []).map((cell) => cell.party),
  );
  return [...parties].sort();
});

function isHit(optionId: string): boolean {
  const option = optionById.value.get(optionId);
  const answer = puzzle.value?.answer;
  if (!option || !answer) return false;
  return terytToPowiat(option.teryt) === terytToPowiat(answer.teryt);
}

const guessRows = computed(() => {
  const answer = puzzle.value?.answer;
  if (!answer) return [];
  return guesses.value.flatMap((id) => {
    const option = optionById.value.get(id);
    if (!option) return [];
    const hit = isHit(id);
    const distance = hit ? 0 : Math.round(haversineKm(option, answer));
    const percent = hit ? 100 : proximityPercent(distance);
    return [
      {
        id,
        name: option.name,
        hit,
        distance,
        arrow: directionArrow(bearingDeg(option, answer)),
        percent,
        squares: proximitySquares(percent),
      },
    ];
  });
});

const won = computed(() => guesses.value.some((id) => isHit(id)));
const finished = computed(
  () => won.value || guesses.value.length >= korytleMaxGuesses,
);

const availableOptions = computed(() =>
  (puzzle.value?.options ?? []).filter(
    (option) => !guesses.value.includes(option.id),
  ),
);

const revealGroups = computed(() => {
  const groups = new Map<string, KorytlePersonReveal[]>();
  for (const person of puzzle.value?.people ?? []) {
    if (!groups.has(person.branza)) groups.set(person.branza, []);
    groups.get(person.branza)!.push(person);
  }
  return [...groups.entries()]
    .map(([branza, people]) => ({ branza, people }))
    .sort((a, b) => b.people.length - a.people.length);
});

function profileUrl(person: KorytlePersonReveal): string {
  return generateEntityUrl("person", person.id, person.name);
}

function notify(text: string) {
  snackbarText.value = text;
  snackbar.value = true;
}

function submitGuess() {
  if (!selectedId.value || guesses.value.includes(selectedId.value)) return;
  guesses.value = [...guesses.value, selectedId.value];
  selectedId.value = null;
}

const emojiRows = computed(() =>
  guessRows.value
    .map((row) =>
      row.hit
        ? `${row.squares} 🎯 100%`
        : `${row.squares} ${row.arrow} ${row.percent}%`,
    )
    .join("\n"),
);

async function shareResult() {
  const attempts = won.value ? `${guesses.value.length}` : "X";
  const text = `Korytle koryta.pl #${puzzle.value?.number} — ${attempts}/${korytleMaxGuesses}\n${emojiRows.value}\nhttps://koryta.pl/gry/korytle`;
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

onMounted(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (stored?.date !== today || !Array.isArray(stored.guesses)) return;
    guesses.value = stored.guesses.filter(
      (id: unknown) => typeof id === "string" && optionById.value.has(id),
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
.mosaic {
  height: 320px;
}
.mosaic-col {
  min-width: 0;
}
.mosaic-cell {
  min-height: 0;
  border-radius: 4px;
  margin-top: 2px;
}
.mosaic-cell-label {
  color: white;
  font-size: 0.75rem;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.7);
}
.party-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
</style>
