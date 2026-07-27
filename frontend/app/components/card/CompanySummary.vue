<template>
  <v-card variant="outlined" class="h-100">
    <v-card-title class="d-flex align-center text-wrap pb-0">
      <v-icon :icon="mdiOfficeBuildingOutline" class="mr-2 flex-shrink-0" />
      <span>{{ company.name }}</span>
    </v-card-title>
    <v-card-text class="pt-2">
      <div v-if="company.krsNumber" class="text-body-2">
        <strong>KRS:</strong> {{ company.krsNumber }}
      </div>
      <div v-if="location" class="text-body-2">
        <strong>Lokalizacja:</strong> {{ location }}
      </div>
      <ChipPublicCompany :is-public="company.isPublic" class="mt-2" />
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
import { mdiOfficeBuildingOutline } from "@mdi/js";
import type { Company } from "~~/shared/model";

defineProps<{
  company: Company;
  /** Region the company sits in, resolved by the caller from the owns edge. */
  location: string | undefined;
}>();
</script>
