<template>
  <div class="map-legend" data-testid="map-legend">
    <template v-if="fallback">
      <div class="map-legend__title">Osoby w powiecie</div>
      <div class="map-legend__steps">
        <div
          v-for="step in peopleSteps"
          :key="step.label"
          class="map-legend__step"
          :class="{ 'map-legend__step--apart': step.apart }"
        >
          <span class="map-legend__bar" :style="{ background: step.fill }" />
          <span>{{ step.label }}</span>
        </div>
      </div>
    </template>

    <template v-else-if="mode === ALL_PARTIES">
      <div class="map-legend__title">Najliczniejsza partia i jej udział</div>
      <div v-if="leaders.length" class="map-legend__grid">
        <span />
        <span v-for="label in LEAD_STEPS" :key="label">{{ label }}</span>
        <template v-for="party in leaders" :key="party">
          <span class="map-legend__rowhead">{{ partyLabel(party) }}</span>
          <span
            v-for="(fill, index) in choroplethLead[party]"
            :key="index"
            class="map-legend__cell"
            :style="{ background: fill }"
          />
        </template>
      </div>
      <!-- A phone's form of the grid: one line of ramps and the steps once
           under them, so the list below the map starts higher (decision on
           2026-11-18). -->
      <div v-if="leaders.length" class="map-legend__ramps">
        <span v-for="party in leaders" :key="party" class="map-legend__ramp">
          <span class="map-legend__ramp-name">{{ partyLabel(party) }}</span>
          <span
            v-for="(fill, index) in choroplethLead[party]"
            :key="index"
            class="map-legend__ramp-step"
            :style="{ background: fill }"
          />
        </span>
      </div>
      <div v-if="leaders.length" class="map-legend__caption">
        {{ LEAD_STEPS.join(", ") }}
      </div>
      <div class="map-legend__items">
        <span class="map-legend__item">
          <span class="map-legend__swatch" :style="swatch(choropleth.tie)" />
          remis lub Inne
        </span>
        <span class="map-legend__item">
          <span class="map-legend__swatch" :style="swatch(choropleth.thin)" />
          za mało osób
        </span>
        <span class="map-legend__item">
          <span class="map-legend__swatch" :style="swatch(choropleth.empty)" />
          brak osób
        </span>
      </div>
    </template>

    <template v-else>
      <div class="map-legend__title">{{ shareTitle }}</div>
      <div class="map-legend__steps">
        <div
          v-for="step in shareSteps"
          :key="step.label"
          class="map-legend__step"
          :class="{ 'map-legend__step--apart': step.apart }"
        >
          <span class="map-legend__bar" :style="{ background: step.fill }" />
          <span>{{ step.label }}</span>
        </div>
      </div>
      <div class="map-legend__items">
        <span class="map-legend__item">
          <span class="map-legend__swatch" :style="swatch(choropleth.thin)" />
          za mało osób
        </span>
        <span class="map-legend__item">
          <span class="map-legend__swatch" :style="swatch(choropleth.empty)" />
          brak osób
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  choropleth,
  choroplethLead,
  choroplethPeople,
  choroplethShare,
  ink,
} from "~/utils/chartTheme";
import { ALL_PARTIES, partyLabel } from "~/utils/regionMap";
import { OTHER_PARTY } from "~~/shared/misc";

const props = defineProps<{
  /** `ALL_PARTIES`, or the party whose share the map shows. */
  mode: string;
  /** The parties leading at least one powiat, in the chips' order. */
  leaders: string[];
  /** No party counts yet: the map colours people. */
  fallback?: boolean;
}>();

const LEAD_STEPS = ["do 45%", "45-59%", "60%+"];

/** The style block's colours. A local and not `ink` itself: in dev, an
 * import only the style block reads is missing from the SSR context. */
const text = {
  primary: ink.primary,
  secondary: ink.secondary,
  muted: ink.muted,
};

/** „Udział X wśród osób z partią”, X in the genitive. A party missing here
 * reads „X: udział wśród osób z partią”. */
const GENITIVE: Record<string, string> = {
  PO: "PO",
  PiS: "PiS",
  PSL: "PSL",
  "Polska 2050": "Polski 2050",
  "Nowa Lewica": "Nowej Lewicy / SLD",
  Konfederacja: "Konfederacji",
  Nowoczesna: "Nowoczesnej",
  "Bezpartyjni Samorządowcy": "Bezpartyjnych Samorządowców",
  [OTHER_PARTY]: "innych partii",
};

const shareTitle = computed(() => {
  const genitive = GENITIVE[props.mode];
  return genitive
    ? `Udział ${genitive} wśród osób z partią`
    : `${partyLabel(props.mode)}: udział wśród osób z partią`;
});

const shareSteps = computed(() => {
  const ramp = choroplethShare[props.mode] ?? [];
  return [
    { fill: choropleth.none, label: "0", apart: true },
    ...["1-19%", "20-39%", "40-59%", "60%+"].map((label, index) => ({
      fill: ramp[index] ?? choropleth.tie,
      label,
      apart: false,
    })),
  ];
});

const peopleSteps = [
  { fill: choropleth.empty, label: "0", apart: true },
  ...["1-4", "5-9", "10-19", "20-49", "50-99", "100+"].map((label, index) => ({
    fill: choroplethPeople[index]!,
    label,
    apart: false,
  })),
];

const swatch = (fill: string) => ({ background: fill });
</script>

<style scoped>
.map-legend {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 640px;
  margin: 16px auto 0;
  font-size: 0.75rem;
  line-height: 1rem;
  color: v-bind("text.secondary");
  font-variant-numeric: tabular-nums;
}

.map-legend__title {
  font-size: 0.8125rem;
  line-height: 1.125rem;
  font-weight: 500;
  color: v-bind("text.primary");
  text-align: center;
  text-wrap: balance;
}

.map-legend__steps {
  display: flex;
  justify-content: center;
  gap: 2px;
  width: 100%;
}

.map-legend__step {
  display: flex;
  flex: 0 1 52px;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  white-space: nowrap;
}

.map-legend__step--apart {
  margin-right: 10px;
}

.map-legend__bar,
.map-legend__cell,
.map-legend__swatch {
  /* A hairline of ink, so the palest steps still have an edge on white. */
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.map-legend__bar {
  width: 100%;
  height: 10px;
  border-radius: 2px;
}

.map-legend__grid {
  display: grid;
  grid-template-columns: auto repeat(3, 44px);
  gap: 2px;
  align-items: center;
  text-align: center;
}

.map-legend__rowhead {
  padding-right: 8px;
  text-align: right;
  font-weight: 500;
  color: v-bind("text.primary");
}

.map-legend__cell {
  height: 14px;
  border-radius: 2px;
}

.map-legend__items {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 16px;
}

.map-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.map-legend__swatch {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.map-legend__ramps,
.map-legend__caption {
  display: none;
}

/* On a phone the list of people is under the map and the legend, so the
   legend keeps to three short lines. */
@media (max-width: 599.98px) {
  .map-legend {
    gap: 6px;
    margin-top: 10px;
    font-size: 0.6875rem;
    line-height: 0.875rem;
  }

  .map-legend__title {
    font-size: 0.75rem;
    line-height: 1rem;
  }

  .map-legend__step {
    flex-basis: 44px;
  }

  .map-legend__bar {
    height: 8px;
  }

  .map-legend__grid {
    display: none;
  }

  .map-legend__ramps {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 14px;
  }

  .map-legend__ramp {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .map-legend__ramp-name {
    margin-right: 4px;
    font-weight: 500;
    color: v-bind("text.primary");
  }

  .map-legend__ramp-step {
    width: 14px;
    height: 10px;
    border-radius: 2px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  }

  .map-legend__caption {
    display: block;
    margin-top: -2px;
    color: v-bind("text.muted");
  }

  .map-legend__items {
    gap: 4px 10px;
  }

  .map-legend__item {
    gap: 4px;
  }

  .map-legend__swatch {
    width: 10px;
    height: 10px;
  }
}
</style>
