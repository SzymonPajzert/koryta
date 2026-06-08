<template>
  <div
    :class="
      vertical
        ? 'd-flex flex-column align-center ga-2 pt-1'
        : 'd-flex align-center ga-2'
    "
  >
    <v-tooltip text="Przeglądaj w tabeli" :location="vertical ? 'left' : 'top'">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          :icon="mdiTable"
          variant="tonal"
          color="secondary"
          to="/eksploruj/tabela?visibility=private&hideVoted=no_votes&sortBy=votes.interesting&sortDesc=true"
        />
      </template>
    </v-tooltip>

    <v-tooltip text="Zobacz statystyki" :location="vertical ? 'left' : 'top'">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          :icon="mdiChartLine"
          variant="tonal"
          color="blue"
          to="/eksploruj/statystyki"
        />
      </template>
    </v-tooltip>

    <v-btn
      color="primary"
      :icon="vertical ? mdiCheckAll : undefined"
      :prepend-icon="!vertical ? mdiCheckAll : undefined"
      variant="outlined"
      :class="vertical ? 'mt-2' : undefined"
      :text="vertical ? undefined : 'Następna osoba'"
      @click="$emit('next')"
    />
  </div>
</template>

<script setup lang="ts">
import { mdiChartLine, mdiCheckAll, mdiTable } from "@mdi/js";
defineProps<{
  vertical?: boolean;
  pending?: boolean;
  allActionsDone?: boolean;
}>();

defineEmits<{
  (e: "next"): void;
}>();
</script>
