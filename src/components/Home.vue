<template>
  <div>
    <v-row>
      <v-col cols="8">
        <v-img class="mb-4" height="150" src="@/assets/świnia.png" />

        <div class="mb-8 text-center">
          <h1 class="text-h2 font-weight-bold">koryta.pl</h1>
          <div class="text-body-2 font-weight-light mb-n1">Polityczny wypas</div>
        </div>
      </v-col>
      <v-col cols="4">
        <PartyChart></PartyChart>
      </v-col>

      <v-col v-for="link in links" :key="link.href" cols="12">
        <v-card
          append-icon="mdi-open-in-new"
          class="py-4"
          color="surface-variant"
          :to="link.destination"
          :prepend-icon="link.icon" rel="noopener noreferrer" rounded="lg" variant="tonal">

          <template #title>
            <h2 class="text-h5 font-weight-bold">
              {{ link.title }}
            </h2>
          </template>

          <template #subtitle>
            <div class="text-subtitle-1">
              {{ link.subtitle }}
            </div>
          </template>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import PartyChart from './PartyChart.vue';

const links = [
  {
    destination: 'list',
    icon: 'mdi-text-box-outline',
    title: 'Zobacz listę',
  },
  {
    destination: 'add',
    icon: 'mdi-plus-box-outline',
    subtitle: 'Dodaj brakujące osoby w spółkach państwa lub samorządu',
    title: 'Dodaj osoby',
  },
  {
    destination: 'login',
    icon: 'mdi-star-circle-outline',
    subtitle: 'Zaloguj się lub dołącz do serwera Discord',
    title: 'Dołącz do projektu',
  },
]
</script>
