<template>
  <v-tooltip v-if="isPublic !== undefined" :text="tooltip" location="bottom">
    <template #activator="{ props: tooltipProps }">
      <v-chip
        v-bind="tooltipProps"
        :color="isPublic ? 'primary' : undefined"
        :prepend-icon="isPublic ? mdiBankOutline : mdiDomain"
        size="x-small"
        variant="tonal"
      >
        {{ isPublic ? "Spółka publiczna" : "Spółka prywatna" }}
      </v-chip>
    </template>
  </v-tooltip>
</template>

<script lang="ts" setup>
import { mdiBankOutline, mdiDomain } from "@mdi/js";

// Undefined means KRS gave us nothing to judge by, so we stay silent rather
// than claiming the company is private.
const props = defineProps<{ isPublic: boolean | undefined }>();

const tooltip = computed(() =>
  props.isPublic
    ? "Spółka należąca do skarbu państwa lub samorządu, według KRS. " +
      "Dotyczy też spółek zależnych od takich spółek."
    : "Według KRS spółka nie należy do skarbu państwa ani samorządu.",
);
</script>
