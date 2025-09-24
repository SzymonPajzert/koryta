<template>
  <v-alert type="info" closable>
  Jeśli masz pytania,
  <a href="https://discord.gg/pnyPh7zXxS" target="_blank" class="text-white">
    dołącz do serwera Discord
  </a>
  - mamy kanał specjalnie dla koryta.pl
  </v-alert>
  <v-btn to="/pomoc/zadania">Zadania</v-btn>
  <v-btn to="/pomoc/artykuly">Artykuły</v-btn>
  <v-btn to="/pomoc/poszlaki">Poszlaki</v-btn>
  <v-btn to="/pomoc/statystyki">Statystyki</v-btn>
  <router-view :allowed-issues="allowedIssues" />
</template>

<script lang="ts" setup>
definePageMeta({
  title: "Działaj z nami",
  isHelp: true,
  middleware: "auth",
});

const { allowedIssues } = defineProps<{ allowedIssues: string[] }>();
</script>
