<template>
  <div>
    <v-row>
      <v-col cols="12" md="5" class="text-center">
        <v-img position="center" height="300" src="@/assets/logo.png"/>
      </v-col>
      <v-col cols="12" md="7">
        <v-card
          to="/lista"
          class="py-4"
          color="surface-variant"
          variant="tonal"
          rounded="lg"
        >
          <v-card-title>
            <h2 class="text-h5 font-weight-bold">
              Lista wszystkich {{ Object.values(people).length }}
              {{ koryciarz.plural.genitive }}
            </h2>
          </v-card-title>
          <v-card-text>
            <ClientOnly>
              <TreemapPartyChart />
            </ClientOnly>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12">
        <v-card
          to="/kpo"
          class="py-4"
          color="surface-variant"
          variant="tonal"
          rounded="lg"
        >
          <v-card-title>
            <h2 class="text-h5 font-weight-bold">
              Zagłosuj na najśmieszniejsze zgłoszenia w KPO
            </h2>
          </v-card-title>
          <v-card-text>
            Czy jacht, czy zestaw do kawy są najbardziej odklejonymi pomysłami?
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card
          to="/graf?miejsce=-OTOq2CpVuIll16NmukB"
          class="py-4"
          color="surface-variant"
          variant="tonal"
          rounded="lg"
        >
          <v-card-title>
            <h2 class="text-h5 font-weight-bold">
              Zobacz jak PSL przejęło PKP
            </h2>
          </v-card-title>
          <v-card-text>
            <v-img class="mb-4" height="250" src="@/assets/psl_pkp.png" />
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card
          to="/graf?miejsce=-OTP58QPQ2cUXMgPn7UL"
          class="py-4"
          color="surface-variant"
          variant="tonal"
          rounded="lg"
        >
          <v-card-title>
            <h2 class="text-h5 font-weight-bold">
              Albo PL2050 ministerstwo klimatu
            </h2>
          </v-card-title>
          <v-card-text>
            <v-img class="mb-4" height="250" src="@/assets/polska2050.png" />
          </v-card-text>
        </v-card>
      </v-col>

      <HomeItem router="pomoc" icon="mdi-plus-box-outline">
        <template #header> Dodaj osoby i artykuły </template>
        Dodaj brakujące osoby w spółkach państwa lub samorządu albo linki do
        artykułów wypisujących je.
      </HomeItem>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { useFeminatyw } from "@/composables/feminatyw";
import { createEntityStore } from "@/stores/entity";

const useListEntity = createEntityStore("employed");
const entityStore = useListEntity();
const { entities: people } = storeToRefs(entityStore);
const { koryciarz } = useFeminatyw();

const idx = import.meta.test ? 1 : Math.floor(Math.random() * 2);
const subtitle = ["Polityczny wypas", "Pójdź tam, gdzie politycy zimują"][idx];
</script>
