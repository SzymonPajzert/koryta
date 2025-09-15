<template>
  <v-col cols="12">
    <h2 class="text-h5 font-weight-bold">Rzeczy do zrobienia:</h2>
    <EntityStatusList :allowed-issues="allowedIssues" />
  </v-col>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "Zadania",
  isHelp: true,
});

const { allowedIssues } = defineProps<{ allowedIssues: string[] }>();
</script>
