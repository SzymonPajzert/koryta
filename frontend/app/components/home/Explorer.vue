<template>
  <v-container :style="{ background: 'white' }">
    <v-row>
      <v-col cols="12" class="d-md-none pb-0">
        <v-tabs
          v-model="tab"
          :color="TAB_COLOUR"
          grow
          @update:model-value="countSwitch"
        >
          <v-tab value="map">Mapa</v-tab>
          <v-tab value="graph">Wykres</v-tab>
        </v-tabs>
      </v-col>
      <v-col cols="12" md="8">
        <v-tabs-window :model-value="tab">
          <v-tabs-window-item value="map">
            <HomeHeading title="Mapa koryciarstwa" center />
            <ChartPolandMap @click="pickRegion" />
          </v-tabs-window-item>
          <v-tabs-window-item value="graph">
            <HomeHeading title="Stanowiska w czasie" center />
            <HomeTimeline :grouping="grouping" :range="range" />
          </v-tabs-window-item>
        </v-tabs-window>
      </v-col>
      <v-col cols="12" md="4">
        <v-tabs
          v-model="tab"
          :color="TAB_COLOUR"
          grow
          class="d-none d-md-flex"
          @update:model-value="countSwitch"
        >
          <v-tab value="map">Mapa</v-tab>
          <v-tab value="graph">Wykres</v-tab>
        </v-tabs>

        <!-- The side panel is the map's result list, and the chart's controls.
             Both are "what you do next with this panel", so they take the same
             column rather than the chart growing a control strip of its own. -->
        <HomeTimelineControls
          v-if="tab === 'graph'"
          v-model:grouping="grouping"
          v-model:range="range"
        />
        <CardPeopleList v-else :region="region" />
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" setup>
import { trackGoal } from "~/composables/analytics";
import { useExperimentArm } from "~/composables/experiments";
import { HOME_DEFAULT_EXPERIMENT } from "~~/shared/experiments";

import type { TimelineRange } from "~/composables/homeTimeline";
import type { TimelineGrouping } from "~~/server/api/stats/homeTimeline.get";

import type { Powiat } from "@/composables/entity/regions";

/** What the selected tab is painted in.
 *
 * Not `primary`. That token is #a8c79f, a pale sage meant as a *fill*, and
 * `shared/colors.ts` measures it at 1.85:1 as text on white - lighter than the
 * rgba(0,0,0,.87) the unselected tabs carry. So selecting a tab made its label
 * fade out and drew a 2px underline nobody could see: the strip answered a
 * click by looking less selected, not more. `ink.sage` is the dark companion
 * that module exists to provide, 6.43:1 on this white panel. */
const TAB_COLOUR = "ink-sage";

/** The panels this component actually renders.
 *
 * `home-default` also declares a `gry` arm, for the games hub that lives on
 * another branch - so an arm can name a panel that is not here. It carries no
 * weight today and cannot be assigned, but a weight is one number in a registry
 * and a blank window on the home page is a worse failure than an unhonoured
 * experiment. Anything unrecognised stays on the map. */
const PANELS = ["map", "graph"] as const;
type Panel = (typeof PANELS)[number];

function isPanel(value: unknown): value is Panel {
  return PANELS.includes(value as Panel);
}

const tab = ref<Panel>("map");
const region = ref<Powiat | undefined>(undefined);

/** The chart's two settings, held here rather than in either component that
 * uses them: the controls are in the right hand column and the chart is in the
 * left, so neither is the other's parent. */
const range = ref<TimelineRange>("all");
const grouping = ref<TimelineGrouping>("party");

// Counted separately from `home-explorer:tab`, and separately from each other:
// what a reader reaches for once they are on the chart is a different question
// from whether they got there at all.
watch(grouping, (value) => trackGoal("home-timeline:grouping", { value }));
watch(range, (value) => trackGoal("home-timeline:range", { value }));

/** Dormant: every reader is on the `map` arm until the weights in
 * `shared/experiments.ts` move, so this resolves to what the page already did.
 * What it does today is record the arm, which is what makes the split readable
 * on a Growth plan when it is switched on. */
const arm = useExperimentArm(HOME_DEFAULT_EXPERIMENT);
watch(arm, (value) => {
  if (isPanel(value)) tab.value = value;
});

/** Counts a switch. It does not perform one - `v-model` already did.
 *
 * This used to be `:model-value` plus a handler that wrote the emitted value
 * back, so that a switch made by the reader could be told from one made by the
 * experiment: with `v-model` the ref is already updated by the time a sibling
 * `@update:model-value` listener runs, so there was nothing left to compare
 * against.
 *
 * That round trip is gone, because it put the strip's state and `tab` in two
 * places that could disagree - and the handler could *refuse* a value, which
 * left the strip underlining one panel while the window showed another, and no
 * later click could recover it: the strip had nothing new to emit. Vuetify owns
 * the selection now, so the underline and the window cannot come apart.
 *
 * Telling the two apart survives the change without the comparison. A `v-tabs`
 * only emits when it changed the value itself, which is a reader clicking it;
 * `tab` moving because the experiment assigned a panel updates the prop and
 * emits nothing. So the emission *is* the signal, and both strips are bound to
 * the same ref - the one that was not clicked syncs from the prop silently, so
 * one reader is still one goal.
 */
function countSwitch(value: unknown) {
  if (!isPanel(value)) return;
  trackGoal("home-explorer:tab", { tab: value });
}

/** The map's conversion. `panel` is still on the goal even though the map is
 * the only panel that reports one: the chart panel's equivalent is the two
 * settings it records, and a shared goal keeps the comparison possible if a
 * third panel ever arrives.
 *
 * Keyed by teryt rather than name, which is optional on a Powiat. 380 values is
 * a long breakdown but a legitimate one, and it is the only place the site
 * would learn which parts of the country people look for. */
function pickRegion(picked: Powiat) {
  region.value = picked;
  trackGoal("home-explorer:pick", { panel: "map", value: picked.teryt });
}
</script>
