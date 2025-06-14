<template>
  <div>
    <v-row>
      <v-col v-for="person in people" :key="person.name" cols="12">
        <v-card
          class="py-4"
          color="surface-variant"
          prepend-icon="mdi-account-outline"
          rounded="lg"
          variant="tonal"
        >
          <template #title>
            <h2 class="text-h5 font-weight-bold">
              {{ person.name }}
            </h2>
          </template>

          <template #subtitle>
            <div class="text-subtitle-1">
              <span class="chip chip--category">
                PSL
              </span>
            </div>
          </template>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import {useListEmployment} from '@/composables/party'
const { people } = useListEmployment();
</script>

<style scoped>
.chip {
  padding: 0.1rem 0.4rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 0.3rem;
  font-weight: 550;
}

.chip--category {
  background-color: var(--primary);
  color: var(--on-primary);
}</style>
