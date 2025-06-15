<template>
  <div>
    <v-row>
      <v-col cols="8">
        <v-img class="mb-4" height="150" src="@/assets/świnia.png" />

        <div class="mb-8 text-center">
          <h1 class="text-h2 font-weight-bold">koryta.pl</h1>
          <div class="text-body-2 font-weight-light mb-n1">
            {{ ["Polityczny wypas", "Pójdź tam, gdzie politycy zimują"][Math.floor(Math.random() * 2)] }}
          </div>
        </div>
      </v-col>
      <v-col cols="4">
        <PartyChart />
      </v-col>

      <HomeItem router="list" icon="mdi-text-box-outline">
        <template #header>
          Zobacz listę {{ people.length }} {{ koryciarz.plural.genitive }}
        </template>
        Osób na ciepłych państwowych posadkach, dzięki ich rodzicom, rodzeństwu lub kolegom z pracy.
      </HomeItem>
      <HomeItem icon="mdi-plus-box-outline">
        <template #header> Dodaj osoby </template>
        Dodaj brakujące osoby w spółkach państwa lub samorządu, w prawym górnym rogu ekranu.
      </HomeItem>
      <HomeItem router="login" icon="mdi-star-circle-outline">
        <template #header> Dołącz do projektu </template>
        <a href="/login" @click.stop to='/login'>Zaloguj się</a> lub
        <a href="https://discord.gg/pnyPh7zXxS" target="_blank" @click.stop
          >dołącz do serwera Discord</a
        >
      </HomeItem>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { useFeminatyw } from "@/composables/feminatyw";
import PartyChart from "./PartyChart.vue";
import { useListEmployment } from "@/composables/party";
import SimpleSuggestionDialog from "./SimpleSuggestionDialog.vue";
const { people } = useListEmployment();
const { koryciarz } = useFeminatyw();
</script>
