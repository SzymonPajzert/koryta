<template>
  <v-row class="mb-4">
    <v-col v-if="showVisibility" cols="12" md="4">
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
    <v-col cols="12" :md="showVisibility ? 4 : 6">
      <v-autocomplete
        v-model="party"
        :items="availableParties"
        label="Partia"
        variant="outlined"
        density="comfortable"
        hide-details
        clearable
        multiple
        chips
        closable-chips
      />
    </v-col>
    <v-col cols="12" :md="showVisibility ? 4 : 6">
      <v-autocomplete
        v-model="teryt"
        :items="availableRegions"
        label="Okręg wyborczy"
        variant="outlined"
        density="comfortable"
        hide-details
        clearable
      />
    </v-col>
    <v-col cols="12" :md="showVisibility ? 4 : 6">
      <v-autocomplete
        v-model="krs"
        :items="availableCompanies"
        label="Spółki"
        variant="outlined"
        density="comfortable"
        hide-details
        clearable
        multiple
        chips
        closable-chips
      />
    </v-col>
    <v-col cols="12" class="pt-0">
      <v-checkbox
        v-model="hideVoted"
        label="Ukryj osoby, na które już głosowano"
        density="compact"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
const visibility = defineModel<"all" | "public" | "private">("visibility");
const party = defineModel<string[] | null>("party");
const teryt = defineModel<string | null>("teryt");
const krs = defineModel<string[] | null>("krs");
const hideVoted = defineModel<boolean>("hideVoted");

withDefaults(
  defineProps<{
    availableParties: { title: string; value: string }[] | string[];
    availableRegions: { title: string; value: string }[];
    availableCompanies: { title: string; value: string }[];
    showVisibility?: boolean;
  }>(),
  {
    showVisibility: true,
  },
);
</script>
