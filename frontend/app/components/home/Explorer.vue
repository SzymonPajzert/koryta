<template>
  <v-container :style="{ background: 'white' }">
    <v-row>
      <v-col cols="12" class="d-md-none pb-0">
        <v-tabs
          :model-value="tab"
          color="primary"
          grow
          @update:model-value="selectTab"
        >
          <v-tab value="map">Mapa</v-tab>
          <v-tab value="parties">Partie</v-tab>
        </v-tabs>
      </v-col>
      <v-col cols="12" md="8">
        <v-tabs-window :model-value="tab">
          <v-tabs-window-item value="map">
            <HomeHeading title="Mapa koryciarstwa" center />
            <ChartPolandMap @click="pickRegion" />
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
                  <LazyChartTreemapParty
                    @select="trackGoal('home-parties:party', { party: $event })"
                  />
                </ClientOnly>
              </v-card-text>
            </v-card>
          </v-tabs-window-item>
        </v-tabs-window>
      </v-col>
      <v-col cols="12" md="4">
        <v-tabs
          :model-value="tab"
          color="primary"
          grow
          class="d-none d-md-flex"
          @update:model-value="selectTab"
        >
          <v-tab value="map">Mapa</v-tab>
          <v-tab value="parties">Partie</v-tab>
        </v-tabs>

        <CardPeopleList :region="region" />
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" setup>
import { polishCounting } from "@/composables/polish";
import { useStats } from "~/composables/stats/useStats";
import { trackGoal } from "~/composables/analytics";
import { useExperimentArm } from "~/composables/experiments";
import { HOME_DEFAULT_EXPERIMENT } from "~~/shared/experiments";

import type { Powiat } from "@/composables/entity/regions";

const { approved } = useStats();

/** The panels this component actually renders.
 *
 * `home-default` also declares a `gry` arm, for the games hub that lives on
 * another branch - so an arm can name a panel that is not here. It carries no
 * weight today and cannot be assigned, but a weight is one number in a registry
 * and a blank window on the home page is a worse failure than an unhonoured
 * experiment. Anything unrecognised stays on the map. */
const PANELS = ["map", "parties"] as const;
type Panel = (typeof PANELS)[number];

function isPanel(value: unknown): value is Panel {
  return PANELS.includes(value as Panel);
}

const tab = ref<Panel>("map");
const region = ref<Powiat | undefined>(undefined);

/** Dormant: every reader is on the `map` arm until the weights in
 * `shared/experiments.ts` move, so this resolves to what the page already did.
 * What it does today is record the arm, which is what makes the split readable
 * on a Growth plan when it is switched on. */
const arm = useExperimentArm(HOME_DEFAULT_EXPERIMENT);
watch(arm, (value) => {
  if (isPanel(value)) tab.value = value;
});

/** Explicitly controlled rather than `v-model`, so that a switch made by the
 * reader is distinguishable from one made by the experiment.
 *
 * With `v-model` the bound ref is already updated by the time a sibling
 * `@update:model-value` listener runs, so there is nothing left to compare
 * against and no way to tell an echo from a click - and there are two tab
 * strips here, one per breakpoint, bound to the same value. */
function selectTab(value: unknown) {
  if (!isPanel(value) || value === tab.value) return;
  tab.value = value;
  trackGoal(
    value === "parties" ? "home-explorer:tab-parties" : "home-explorer:tab-map",
  );
}

/** The map's only conversion. The powiat goes in a property rather than the
 * goal name - there are 380 of them, and on a Growth plan the property is
 * dropped, which is the right trade: one readable goal beats 380 unusable
 * ones. Keyed by teryt rather than name, which is optional on a Powiat. */
function pickRegion(picked: Powiat) {
  region.value = picked;
  trackGoal("home-map:region", { region: picked.teryt });
}
</script>
