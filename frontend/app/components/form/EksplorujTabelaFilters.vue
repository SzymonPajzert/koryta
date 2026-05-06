<template>
  <v-row class="mb-4">
    <v-col cols="12" md="4">
      <v-select
        v-model="visibility"
        :items="[
          { title: 'Wszystkie', value: 'all' },
          { title: 'Opublikowane', value: 'public' },
          { title: 'Szkice', value: 'private' },
        ]"
        label="Widoczność"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="4">
      <v-autocomplete
        v-model="party"
        :items="availableParties"
        label="Partia"
        variant="outlined"
        density="comfortable"
        hide-details
        clearable
      />
    </v-col>
    <v-col cols="12" md="4">
      <v-autocomplete
        v-model="electionLocation"
        :items="availableElectionLocations"
        label="Okręg wyborczy"
        variant="outlined"
        density="comfortable"
        hide-details
        clearable
      />
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
const visibility = defineModel<"all" | "public" | "private">("visibility");
const party = defineModel<string | null>("party");
const electionLocation = defineModel<string | null>("electionLocation");

defineProps<{
  availableParties: string[];
  availableElectionLocations: string[];
}>();
</script>
