<template>
  <div>
    <header class="mb-4">
      <div class="d-flex align-center ga-2 flex-wrap">
        <h1 class="text-h4 font-weight-bold">{{ entry.title }}</h1>
        <span
          v-if="number"
          class="text-body-2 text-medium-emphasis"
          data-testid="game-number"
        >
          #{{ number }}
        </span>
      </div>
      <p class="text-body-1 text-medium-emphasis mt-2 mb-0">
        <slot name="lead">{{ entry.tagline }}</slot>
      </p>
    </header>

    <div v-if="pending" class="d-flex justify-center my-12">
      <v-progress-circular indeterminate color="primary" size="64" />
    </div>

    <!-- One message for "the request failed" and "the generator had nothing to
         work with today", because from where the player sits they are the same
         thing: no puzzle. The distinction matters to us, not to them, and the
         route already says which it was in its status code. -->
    <v-alert
      v-else-if="failed"
      type="error"
      variant="tonal"
      data-testid="game-error"
      text="Nie udało się przygotować dzisiejszej zagadki. Spróbuj ponownie później."
    />

    <template v-else>
      <slot :notify="notify" />

      <section v-if="finished" class="mt-6" data-testid="game-result">
        <slot name="result" />
        <v-btn
          v-if="shareText"
          class="mt-3"
          color="primary"
          variant="flat"
          :prepend-icon="mdiShareVariant"
          data-testid="game-share"
          @click="share"
        >
          Udostępnij wynik
        </v-btn>
      </section>

      <!-- The loop between the dailies. Shown once the day is over rather than
           alongside the board: an exit link next to an unfinished puzzle is an
           invitation to abandon it. -->
      <section v-if="finished && others.length" class="mt-8">
        <h2 class="text-subtitle-1 font-weight-bold mb-2">Inne gry na dziś</h2>
        <v-row>
          <v-col v-for="game in others" :key="game.slug" cols="12" sm="6">
            <v-card
              :to="`/gry/${game.slug}`"
              variant="outlined"
              hover
              height="100%"
            >
              <v-card-item>
                <template #prepend>
                  <v-icon :icon="gameIcon(game.slug)" color="primary" />
                </template>
                <v-card-title class="text-subtitle-1">
                  {{ game.title }}
                </v-card-title>
              </v-card-item>
            </v-card>
          </v-col>
        </v-row>
      </section>
    </template>

    <v-snackbar v-model="snackbar" :timeout="2500">{{
      snackbarText
    }}</v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { mdiShareVariant } from "@mdi/js";
import { gameEntry, otherGames } from "~~/shared/games/registry";
import { gameIcon } from "~/utils/gameIcon";
import { shareGameResult } from "~/composables/games";

/** The frame every daily on /gry sits in: its heading and puzzle number, the
 * three states a puzzle can be in, the share button, and the links on to the
 * other dailies.
 *
 * What is deliberately NOT here is anything about a board. A game hands this
 * component its own markup through the default slot and keeps its rules to
 * itself; the shell owns only what would otherwise be written four times and
 * end up four subtly different ways - which is what happened to the share text
 * and the error state across the first two games.
 */
const props = defineProps<{
  /** Which game this is, as its address. Everything else about it - the title,
   * the tagline, the day it started - is read from the registry, so a game
   * cannot be titled one thing here and another on the hub. */
  slug: string;
  /** Which puzzle of this game today is. Optional: a game whose day failed to
   * generate has no number, and a heading reading "#NaN" is worse than none. */
  number?: number;
  pending?: boolean;
  /** Whatever `useFetch` put in `error`, or a puzzle that came back empty. */
  failed?: boolean;
  /** Whether the day is over - won or lost, this component does not ask. */
  finished?: boolean;
  /** The whole share card, emoji and closing url included. Absent while the
   * game is still deciding what it says, which hides the button. */
  shareText?: string;
}>();

const entry = computed(() => gameEntry(props.slug));
const others = computed(() => otherGames(props.slug));

const snackbar = ref(false);
const snackbarText = ref("");

/** Say something to the player. Passed down through the default slot so a
 * board can use it ("tę odpowiedź już próbowałeś") without every game mounting
 * its own snackbar in a different corner. */
function notify(text: string) {
  snackbarText.value = text;
  snackbar.value = true;
}

async function share() {
  if (!props.shareText) return;
  const message = await shareGameResult(props.shareText);
  if (message) notify(message);
}
</script>
