<template>
  <v-card
    :href="source.url"
    target="_blank"
    height="100%"
    class="pa-4 hover-card"
    elevation="1"
  >
    <div class="d-flex flex-column align-center justify-center">
      <div
        class="text-h6 font-weight-bold mb-1 w-100 text-truncate text-center"
      >
        <v-avatar
          :image="`https://www.google.com/s2/favicons?domain=${source.domain}&sz=128`"
          size="small"
        />
        {{ source.domain }}
      </div>
      <div>
        <v-chip size="small" color="primary" variant="flat">
          {{ source.peopleCount }} osób
        </v-chip>
        <v-chip size="small" color="primary" variant="flat">
          {{ source.articleCount }} artykułów
        </v-chip>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import type { SourceStat } from "@/composables/useHomeStats";

defineProps<{
  source: SourceStat;
}>();
</script>

<style scoped>
.hover-card {
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}
.hover-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
</style>
