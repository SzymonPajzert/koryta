<template>
  <v-card class="pa-4" color="surface-variant" variant="tonal" rounded="lg">
    <v-card-title>
      <h2 class="text-h5 font-weight-bold">
        Największa baza danych o powiązaniach
      </h2>
      <div class="text-caption text-medium-emphasis mt-1">
        Agregujemy dane z {{ sources.length }} źródeł
      </div>
    </v-card-title>

    <div class="position-relative mt-4">
      <v-row
        class="transition-all duration-300"
        :class="{ 'collapsed-row': !showAll }"
      >
        <v-col
          v-for="source in displayedSources"
          :key="source.domain"
          cols="12"
          sm="6"
          md="4"
        >
          <HomeSourceCard :source="source" />
        </v-col>
      </v-row>

      <!-- Gradient Overlay when collapsed -->
      <div
        v-if="!showAll && sources.length > 6"
        class="fade-overlay d-flex align-end justify-center pb-2"
      >
        <v-btn
          color="primary"
          variant="elevated"
          prepend-icon="mdi-chevron-down"
          @click="showAll = true"
        >
          Pokaż wszystkie ({{ sources.length }})
        </v-btn>
      </div>

      <!-- Collapse button if expanded -->
      <div
        v-if="showAll && sources.length > 6"
        class="d-flex justify-center mt-4"
      >
        <v-btn
          variant="text"
          prepend-icon="mdi-chevron-up"
          @click="showAll = false"
        >
          Zwiń
        </v-btn>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useHomeStats } from "@/composables/useHomeStats";

const { sourceStats: sources } = useHomeStats();

const showAll = ref(false);

const displayedSources = computed(() => {
  return showAll.value ? sources.value : sources.value.slice(0, 6);
});
</script>

<style scoped>
.collapsed-row {
  max-height: 280px;
  overflow: hidden;
}

.fade-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 120px;
  background: linear-gradient(
    to bottom,
    rgba(var(--v-theme-surface-variant), 0) 0%,
    rgba(var(--v-theme-surface-variant), 0.8) 40%,
    rgb(var(--v-theme-surface-variant)) 100%
  );
  z-index: 2;
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
}
</style>
