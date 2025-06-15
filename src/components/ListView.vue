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
              <PartyChip v-for="party in person.parties" :key="party" :party />
            </h2>
          </template>

          <template #subtitle>
            <div class="text-subtitle-1">
              <template v-for="nepo in person.nepotism">
                {{ nepo.relation }}
                {{ nepo.person.name }} z {{ nepo.person.party }} <template v-if="nepo.person.role">({{ nepo.person.role }})</template>
              </template>
              <br>
              <template v-if="person.employment">
                {{ person.employment.role }} w {{ person.employment.company }}
                <a
                  v-if="person.employment.noSelectionProcess"
                  :href="person.employment.source"
                  target="_blank"
                >
                  (bez konkursu)
                </a>
              </template>
              <template v-else>
                Brak danych o miejscu zatrudnienia
              </template>
            </div>
          </template>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import {type NepoEmployment} from '@/composables/party'
import PartyChip from './PartyChip.vue';

const { people } = defineProps<{ people: NepoEmployment[] }>();
</script>
