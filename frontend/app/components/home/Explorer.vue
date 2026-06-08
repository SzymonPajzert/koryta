<template>
  <v-container :style="{ background: 'white' }">
    <v-row>
      <v-col cols="12" md="8">
        <v-tabs-window v-model="search">
          <v-tabs-window-item value="map">
            <HomeHeading title="Mapa koryciarstwa" center />
            <ChartPolandMap @click="region = $event" />
          </v-tabs-window-item>
          <v-tabs-window-item value="parties">
            <HomeHeading title="Podział na partie" center />
            <v-card
              class="py-4"
              color="surface-variant"
              variant="tonal"
              rounded="lg"
            >
              <v-card-title>
                <h2 class="text-h5 font-weight-bold">
                  Łącznie
                  {{
                    polishCounting(
                      approved,
                      "koryciarz",
                      "koryciarze",
                      "koryciarzy",
                    )
                  }}
                </h2>
              </v-card-title>
              <v-card-text>
                <ClientOnly>
                  <ChartTreemapParty />
                </ClientOnly>
              </v-card-text>
            </v-card>
          </v-tabs-window-item>
        </v-tabs-window>
      </v-col>
      <v-col cols="12" md="4">
        <v-tabs v-model="search" color="primary" grow>
          <v-tab value="map">Mapa</v-tab>
          <v-tab value="parties">Partie</v-tab>
        </v-tabs>

        <CardPeopleList :region="region" />
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" setup>
import { polishCounting } from "@/composables/feminatyw";
import { useStats } from "~/composables/stats/useStats";

import type { Powiat } from "@/composables/entity/regions";

const { approved } = useStats();

const search = ref("map");
const region = ref<Powiat | undefined>(undefined);
</script>
