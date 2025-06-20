<template>
  <div>
    <v-row>
      <v-col v-for="(person, key) in people" :key="person.name" cols="12">
        <v-card
          class="py-4"
          color="surface-variant"
          prepend-icon="mdi-account-outline"
          rounded="lg"
          variant="tonal"
          :href="person.sourceURL"
        >
          <template #title>
            <h2 class="text-h5 font-weight-bold">
              {{ person.name }}
              <PartyChip v-for="party in person.parties" :key="party" :party />
            </h2>
          </template>

          <template #text>
            <div class="text-subtitle-1">
              <template v-for="connection in person.connections" :key="connection">
                {{ connection.text }}
              </template>
              <br>
              <template v-for="employment in person.employments" :key="employment">
                {{ employment.text }}
              </template>

            </div>
          </template>
          <v-card-actions v-if="isAdmin">
            <v-spacer></v-spacer>
            <AddEmployedDialog :initial="person" :editKey="key">
              <template #button="activatorProps">
                <v-btn
                  @click.prevent
                  variant="tonal"
                  prepend-icon="mdi-pencil-outline"
                  v-bind="activatorProps">
                  <template #prepend>
                    <v-icon color="warning"></v-icon>
                  </template>
                  Edytuj
                </v-btn>
              </template>
            </AddEmployedDialog>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import {type NepoEmployment} from '@/composables/party'
import PartyChip from './PartyChip.vue';
import { useAuthState} from '@/composables/auth'
const { isAdmin } = useAuthState();

const { people } = defineProps<{ people: Record<string, NepoEmployment> }>();
</script>
