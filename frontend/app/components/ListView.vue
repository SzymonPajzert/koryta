<template>
  <div>
    <v-row>
      <v-col
        v-for="[key, person] in peopleOrdered"
        :key="person.name"
        cols="12"
        sm="6"
      >
        <v-card
          class="py-4"
          color="surface-variant"
          prepend-icon="mdi-account-outline"
          rounded="lg"
          variant="tonal"
          height="100%"
          :to="`/entity/person/${key}`"
        >
          <template #title>
            <PartyChip v-for="party in person.parties" :key="party" :party />
            <h2 class="text-h5 font-weight-bold">
              {{ person.name }}
            </h2>
          </template>

          <v-card-text v-if="person.content">
            {{ person.content }}
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import type { Person } from "~~/shared/model";
import PartyChip from "./PartyChip.vue";

const { people } = defineProps<{ people: Record<string, Person> }>();
const peopleOrdered = computed<[string, Person][]>(() => {
  const result = Object.entries(people);
  result.sort((a, b) => a[1].name.localeCompare(b[1].name));
  return result;
});
</script>
