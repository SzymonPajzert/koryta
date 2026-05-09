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
        multiple
        chips
        closable-chips
      />
    </v-col>
    <v-col cols="12" md="4">
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
  </v-row>
</template>

<script setup lang="ts">
const visibility = defineModel<"all" | "public" | "private">("visibility");
const party = defineModel<string[] | null>("party");
const teryt = defineModel<string | null>("teryt");

defineProps<{
  availableParties: { title: string; value: string }[] | string[];
  availableRegions: { title: string; value: string }[];
}>();
</script>
