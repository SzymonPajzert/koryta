<template>
  <v-col cols="12" v-if="!user">
    <v-alert type="info" closable>
    Jeśli masz pytania,
    <a href="https://discord.gg/pnyPh7zXxS" target="_blank" class="text-white">
      dołącz do serwera Discord
    </a>
    - mamy kanał specjalnie dla koryta.pl
    </v-alert>
    <v-container> Zaloguj się, by zobaczyć zawartość. </v-container>
  </v-col>
  <template v-else>
    <v-btn to="/pomoc/zadania">Zadania</v-btn>
    <v-btn to="/pomoc/artykuly">Artykuły</v-btn>
    <v-btn to="/pomoc/poszlaki">Poszlaki</v-btn>
    <v-btn to="/pomoc/statystyki">Statystyki</v-btn>
    <router-view :allowedIssues="allowedIssues"></router-view>
  </template>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "Działaj z nami",
  isHelp: true,
});

import { useAuthState } from "@/composables/auth";

const { user } = useAuthState();
const { allowedIssues } = defineProps<{ allowedIssues: string[] }>();
</script>
