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

    <v-col v-for="game in games" :key="game.title" cols="12" md="6">
      <v-card :to="game.to" height="100%" variant="outlined" hover>
        <v-card-item>
          <template #prepend>
            <v-icon :icon="game.icon" size="large" color="primary" />
          </template>
          <v-card-title>{{ game.title }}</v-card-title>
        </v-card-item>
        <v-card-text class="text-medium-emphasis">
          {{ game.desc }}
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" class="mt-4">
      <p class="text-body-2 text-medium-emphasis mb-0">
        Masz pomysł na kolejną grę albo znasz brakujące powiązanie? Baza (i gry)
        rosną dzięki zgłoszeniom użytkowników.
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
import {
  mdiChevronRight,
  mdiMapSearchOutline,
  mdiViewGridOutline,
} from "@mdi/js";

definePageMeta({
  title: "Gry",
  layout: "gry",
  fullWidth: true,
});

const games = [
  {
    title: "Połączenia",
    desc: "Pogrupuj 16 osób w cztery czwórki: wspólna partia, rok wyborów, region albo miejsce pracy. Masz cztery próby — jak w klasycznym Connections.",
    icon: mdiViewGridOutline,
    to: "/gry/polaczenia",
  },
  {
    title: "Korytle",
    desc: "Mozaika koryciarzy z jednego regionu Polski — podzielona według branż spółek i partii. Zgadnij, o które miasto chodzi; po każdej próbie podpowiemy odległość i kierunek.",
    icon: mdiMapSearchOutline,
    to: "/gry/korytle",
  },
];
</script>
