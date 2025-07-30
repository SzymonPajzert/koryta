<template>
  <div>
    <v-row>
      <v-col cols="12" md="6">
        <v-img class="mb-4" height="150" src="@/assets/świnia.png" />

        <div class="mb-8 text-center">
          <h1 class="text-h2 font-weight-bold">koryta.pl</h1>
          <div class="text-body-2 font-weight-light mb-n1">
            {{ subtitle }}
          </div>
        </div>
      </v-col>
      <v-col cols="12" md="6">
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
              Lista wszystkich {{ Object.values(people).length }}
              {{ koryciarz.plural.genitive }}
            </h2>
          </v-card-title>
          <v-card-text>
            <TreemapPartyChart />
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card
          to="/graf/-OTOq2CpVuIll16NmukB"
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
          to="/graf/-OTP58QPQ2cUXMgPn7UL"
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
        artykułów wypisujących je Dodaj brakujące osoby w spółkach państwa lub
        samorządu albo linki do artykułów wypisujących je
      </HomeItem>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { useFeminatyw } from "@/composables/feminatyw";
import { createEntityStore } from "@/stores/entity";
import { isTest } from "@/firebase";

const useListEntity = createEntityStore("employed");
const entityStore = useListEntity();
const { entities: people } = storeToRefs(entityStore);
const { koryciarz } = useFeminatyw();

const idx = isTest() ? 1 : Math.floor(Math.random() * 2);
const subtitle = ["Polityczny wypas", "Pójdź tam, gdzie politycy zimują"][idx];
</script>
