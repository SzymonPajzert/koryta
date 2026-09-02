<template>
  <v-row>
    <v-col cols="12">
      <h1 class="text-h4 font-weight-bold mb-2">Gry koryta.pl</h1>
      <p class="text-body-1 text-medium-emphasis mb-1">
        Codzienna porcja koryt w formie zagadek. Każdego dnia nowa układanka
        oparta na prawdziwych danych z naszej bazy — a wynikiem możesz pochwalić
        się znajomym. Nie musisz znać osób z planszy: każda prowadzi do swojego
        profilu, a szukanie wskazówek to część zabawy.
      </p>
    </v-col>

    <v-col v-for="game in games" :key="game.slug" cols="12" md="6">
      <v-card
        :to="game.status === 'live' ? `/gry/${game.slug}` : undefined"
        :disabled="game.status !== 'live'"
        height="100%"
        variant="outlined"
        :hover="game.status === 'live'"
        :data-testid="`game-card-${game.slug}`"
      >
        <v-card-item>
          <template #prepend>
            <v-icon :icon="gameIcon(game.slug)" size="large" color="primary" />
          </template>
          <v-card-title class="d-flex align-center ga-2">
            {{ game.title }}
            <v-chip v-if="game.status !== 'live'" size="x-small" label>
              wkrótce
            </v-chip>
          </v-card-title>
        </v-card-item>
        <v-card-text class="text-medium-emphasis">
          {{ game.tagline }}
        </v-card-text>
      </v-card>
    </v-col>

    <!-- The hub's own loop: the list above is what there is to play, and this
         is how it grows. Kept on the hub rather than at the end of each daily,
         where it would compete with the cross-promotion to the next game. -->
    <v-col cols="12" class="mt-4">
      <GamesSuggestGame />
    </v-col>

    <v-col cols="12">
      <p class="text-body-2 text-medium-emphasis mb-0">
        Znasz brakujące powiązanie? Baza (i gry) rosną dzięki zgłoszeniom
        użytkowników.
      </p>
      <v-btn
        variant="text"
        color="primary"
        to="/pomoc"
        :append-icon="mdiChevronRight"
        class="ms-n4"
      >
        Działaj z nami
      </v-btn>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
import { mdiChevronRight } from "@mdi/js";
import { games } from "~~/shared/games/registry";
import { gameIcon } from "~/utils/gameIcon";

definePageMeta({
  title: "Gry",
  layout: "gry",
  fullWidth: true,
});

useSeoMeta({
  title: "Gry koryta.pl",
  description:
    "Codzienne zagadki oparte na prawdziwych danych o polskiej polityce i spółkach skarbu państwa.",
});
</script>
