<template>
  <v-container :style="{ background: 'white' }">
    <v-row
      :class="{ 'explorer--pending': !assigned }"
      data-testid="home-explorer"
    >
      <v-col cols="12" class="d-md-none pb-0">
        <!-- The chart is the last tab on both strips and no arm opens on it
             (decision on 2026-11-20). -->
        <!-- Slim, without the 90 px floor, and tracked tighter than the
             desktop strip (`.explorer__phone-tabs`): „MAPA OŚWIADCZENIA
             STANOWISKA” at the default spacing needs a 373 px phone, and
             on a 360 px one, the commonest Android width, the strip clipped
             the third label on the map, where most readers land. -->
        <v-tabs
          v-model="tab"
          :color="TAB_COLOUR"
          grow
          class="explorer__phone-tabs"
          @update:model-value="countSwitch"
        >
          <v-tab value="map" slim min-width="0" @click="pin('map')">Mapa</v-tab>
          <v-tab
            v-if="people"
            value="oswiadczenia"
            slim
            min-width="0"
            @click="pin('oswiadczenia')"
          >
            Oświadczenia
          </v-tab>
          <v-tab value="graph" slim min-width="0" @click="pin('graph')">
            Stanowiska
          </v-tab>
        </v-tabs>
      </v-col>
      <v-col cols="12" md="8">
        <v-tabs-window :model-value="tab">
          <v-tabs-window-item value="map">
            <HomeHeading title="Mapa koryciarstwa" center />
            <ChartPolandMap :picked="region" @click="pickRegion" />
          </v-tabs-window-item>
          <v-tabs-window-item v-if="people" value="oswiadczenia">
            <HomeHeading
              title="Oświadczenia majątkowe"
              :subtitle="DECLARATIONS_SAY"
              center
            />
            <OswiadczeniaPeoplePanel :people="people" />
          </v-tabs-window-item>
          <v-tabs-window-item value="graph">
            <HomeHeading title="Zmiany na stanowiskach" center />
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
          <v-tab value="map" @click="pin('map')">Mapa</v-tab>
          <v-tab
            v-if="people"
            value="oswiadczenia"
            @click="pin('oswiadczenia')"
          >
            Oświadczenia
          </v-tab>
          <v-tab value="graph" @click="pin('graph')">Stanowiska</v-tab>
        </v-tabs>

        <!-- The side panel is the map's result list, and the chart's controls.
             Both are "what you do next with this panel", so they take the same
             column rather than the chart growing a control strip of its own.

             `v-show` on the list, not `v-if`. `CardPeopleList` awaits its data
             in `setup`, which makes it an async component: Vue can only commit
             one inside a `<Suspense>`, and the page's boundary has long since
             resolved by the time a reader clicks a tab. Destroyed and
             re-created it therefore came back as nothing at all - the column
             was empty after map -> stanowiska -> map. Kept mounted and merely
             hidden, it never suspends twice. It was never behind a `v-if`
             before this panel existed either: it stood in this column whichever
             panel was open, so this also restores what it used to cost. -->
        <HomeTimelineControls
          v-if="tab === 'graph'"
          v-model:grouping="grouping"
          v-model:range="range"
        />
        <OswiadczeniaPeopleSide
          v-if="tab === 'oswiadczenia' && people"
          :people="people"
        />
        <CardPeopleList
          v-show="tab === 'map'"
          :region="region"
          @close="region = undefined"
        />
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" setup>
import { trackGoal } from "~/composables/analytics";
import { useExperimentArm } from "~/composables/experiments";
import { useQueryFilters } from "~/composables/queryFilters";
import {
  HOME_PANEL_SLUGS,
  HOME_PANELS,
  panelNamedBy,
  type HomePanel,
} from "~/composables/homeExplorer";
import {
  experimentIsLive,
  HOME_DEFAULT_EXPERIMENT,
} from "~~/shared/experiments";

import type { TimelineRange } from "~/composables/homeTimeline";
import type { TimelineGrouping } from "~~/server/api/stats/homeTimeline.get";

import type { Powiat } from "@/composables/entity/regions";
import type { DeclarationPeople } from "~~/shared/declarations";

/** The night's people snapshot of the declarations: with one, the explorer
 * gets its third panel. Without one (before the job's first night) the strip
 * stays at two tabs rather than offering an empty panel. */
const props = defineProps<{ people?: DeclarationPeople | null }>();

/** What the selected tab is painted in.
 *
 * Not `primary`. That token is #a8c79f, a pale sage meant as a *fill*, and
 * `shared/colors.ts` measures it at 1.85:1 as text on white - lighter than the
 * rgba(0,0,0,.87) the unselected tabs carry. So selecting a tab made its label
 * fade out and drew a 2px underline nobody could see: the strip answered a
 * click by looking less selected, not more. `ink.sage` is the dark companion
 * that module exists to provide, 6.43:1 on this white panel. */
const TAB_COLOUR = "ink-sage";

/** What the declarations panel is for, under its heading. A no-break space
 * after each one-letter word, so none is left hanging at a line's end. */
const DECLARATIONS_SAY =
  "Szukamy oświadczeń majątkowych samorządowców z płatną posadą " +
  "w publicznej spółce lub instytucji. Data urodzenia z oświadczenia " +
  "pokazuje, czy to ta sama osoba co w KRS, czy duplikat.";

/** The panels this component actually renders (`HOME_PANELS`).
 *
 * `home-default` also declares a `gry` arm, for the games hub that lives on
 * another branch - so an arm can name a panel that is not here. It carries no
 * weight today and cannot be assigned, but a weight is one number in a registry
 * and a blank window on the home page is a worse failure than an unhonoured
 * experiment. Anything unrecognised stays on the map. */
type Panel = HomePanel;

function isPanel(value: unknown): value is Panel {
  return HOME_PANELS.includes(value as Panel);
}

/** A panel this page can open now: the declarations' needs the snapshot. */
function canOpen(value: unknown): value is Panel {
  return isPanel(value) && (value !== "oswiadczenia" || !!props.people);
}

/** The panel `?widok=` names, or null when it names none this page can open. */
function namedPanel(value: unknown): Panel | null {
  const panel = panelNamedBy(value);
  return panel && canOpen(panel) ? panel : null;
}

const route = useRoute();
const { setQuery } = useQueryFilters();

/** The panel a link opened the page on. It wins over the arm, and the server
 * renders it, so a link shows its panel from the first paint. */
const linked = namedPanel(route.query.widok);

const tab = ref<Panel>(linked ?? "map");
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

/** The panel this reader's arm opens on, set once the page is in the
 * browser: `/` is served from a shared cache, so the server cannot know the
 * arm. The arm also rides on every later event as a property, which is what
 * makes the split readable.
 *
 * A visit on a link to a panel sits the split out: nothing random decided what
 * it saw first. */
const arm = useExperimentArm(HOME_DEFAULT_EXPERIMENT, {
  sitOut: linked !== null,
});
watch(arm, (value) => {
  if (!linked && canOpen(value)) tab.value = value;
});

/** While readers are split, the panels stay hidden until the arm is set, for
 * every arm alike. Shown at once, the server's render would paint the map for
 * a moment before another arm's panel, and only the map's readers would be
 * spared that: the very difference the split measures. Registered after
 * `useExperimentArm`, so by the time this runs the arm is in `tab`. A linked
 * panel waits for no arm. */
const assigned = ref(
  !experimentIsLive(HOME_DEFAULT_EXPERIMENT) || linked !== null,
);
onMounted(() => {
  assigned.value = true;
});

// A link to another panel followed on this page: the page is not mounted again
// for a new query, so the query is followed here.
watch(
  () => route.query.widok,
  (value) => {
    const panel = namedPanel(value);
    if (panel) tab.value = panel;
  },
);

/** Names the clicked panel in the url, so the address bar links to what is on
 * screen. On a click only, the open tab's too: a panel the arm opened stays
 * out of the url, or every copied home page address would take its readers out
 * of the split. `replace`, so Back leaves the page rather than walking the
 * tabs. */
function pin(panel: Panel) {
  void setQuery({ widok: HOME_PANEL_SLUGS[panel] }, { replace: true });
}

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
  // A second click on the picked powiat unpicks it.
  if (region.value?.teryt === picked.teryt) {
    region.value = undefined;
    return;
  }
  region.value = picked;
  trackGoal("home-explorer:pick", { panel: "map", value: picked.teryt });
}
</script>

<style scoped>
/* Laid out, so nothing below moves when it shows, and not painted. */
.explorer--pending {
  visibility: hidden;
}

/* The three labels fit from a 340 px phone, against 373 px at Vuetify's
   spacing: a third of the tracking and 6 px either side. */
.explorer__phone-tabs :deep(.v-tab) {
  padding-inline: 6px;
}
.explorer__phone-tabs :deep(.v-btn__content) {
  letter-spacing: 0.03em;
}
</style>
