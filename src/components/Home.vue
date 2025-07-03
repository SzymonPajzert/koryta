<template>
  <div>
    <v-row>
      <v-col cols="8">
        <v-img class="mb-4" height="150" src="@/assets/świnia.png" />

        <div class="mb-8 text-center">
          <h1 class="text-h2 font-weight-bold">koryta.pl</h1>
          <div class="text-body-2 font-weight-light mb-n1">
            {{ subtitle }}
          </div>
        </div>
      </v-col>
      <v-col cols="4">
        <PartyChart />
      </v-col>

      <HomeItem router="list" icon="mdi-text-box-outline">
        <template #header>
          Zobacz listę {{ Object.values(people).length }}
          {{ koryciarz.plural.genitive }}
        </template>
        Osób na ciepłych państwowych posadkach, dzięki ich rodzicom, rodzeństwu
        lub kolegom z pracy
      </HomeItem>
      <HomeItem router="pomoc" icon="mdi-plus-box-outline">
        <template #header> Dodaj osoby i artykuły </template>
        Dodaj brakujące osoby w spółkach państwa lub samorządu albo linki do
        artykułów wypisujących je
      </HomeItem>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { useFeminatyw } from "@/composables/feminatyw";
import PartyChart from "./PartyChart.vue";
import { useListEmployment } from "@/composables/party";
import { isTest } from "@/firebase";
const { people } = useListEmployment();
const { koryciarz } = useFeminatyw();

const idx = isTest() ? 1 : Math.floor(Math.random() * 2);
const subtitle = ["Polityczny wypas", "Pójdź tam, gdzie politycy zimują"][idx];
</script>
