<script setup lang="ts">
import { computed, ref, watch } from "vue";
import powiatyPaths from "@/assets/poland_powiaty.json";
import wojewodztwaPaths from "@/assets/poland_voivodeships.json";
import type { Powiat } from "@/composables/entity/regions";
import { authFetch } from "@/composables/auth";
import { trackGoal } from "~/composables/analytics";
import { choropleth } from "~/utils/chartTheme";
import {
  ALL_PARTIES,
  leadFill,
  leadOf,
  partiesByPeople,
  partyLabel,
  peopleFill,
  regionTitle,
  shareFill,
  type MapRow,
} from "~/utils/regionMap";
import { partyChipPaint, partyColors } from "~~/shared/misc";

const hovered = ref<Powiat | null>(null);
/** The powiat whose people the card beside the map lists: outlined until
 * another is picked, so the list says which patch it belongs to. */
const picked = ref<Powiat | null>(null);

const { data: regionStats } = authFetch("/api/stats/regions", {
  lazy: true,
  key: "polandmap-region-stats",
  default: () => [],
});

/** What the map is coloured by: every party, or one party's share. */
const mode = ref(ALL_PARTIES);
watch(mode, (value) =>
  trackGoal("home-map:party", {
    value: value === ALL_PARTIES ? "all" : value,
  }),
);

const hover = (region: Powiat | null) => {
  hovered.value = region;
};

const groupData = computed(() => {
  const map: Record<string, MapRow & { name?: string }> = {};
  for (const g of regionStats.value || []) {
    if (!g.id) continue;

    const item = { people: g.people, parties: g.parties, name: g.name };

    map[g.id] = item;
    if (g.teryt) {
      map[g.teryt] = item;
    }
  }
  return map;
});

const powiaty = computed(() =>
  powiatyPaths.map((p) => {
    const paddedTeryt = p.teryt.padStart(4, "0");
    const group =
      groupData.value["teryt" + paddedTeryt] ||
      groupData.value[p.teryt] ||
      groupData.value[paddedTeryt];
    return {
      ...p,
      id: p.teryt,
      people: group?.people || 0,
      name: group?.name || `Powiat ${paddedTeryt}`,
      row: { people: group?.people || 0, parties: group?.parties },
    };
  }),
);

/** Party counts come with the night's recount; until the first one after
 * this shipped, the map colours people and offers no chips. */
const hasParties = computed(() => powiaty.value.some((p) => p.row.parties));

const parties = computed(() =>
  hasParties.value ? partiesByPeople(powiaty.value.map((p) => p.row)) : [],
);

/** The legend's rows: parties that lead at least one powiat. */
const leaders = computed(() => {
  const leading = new Set<string>();
  for (const p of powiaty.value) {
    const lead = leadOf(p.row);
    if (lead.kind === "party") leading.add(lead.party);
  }
  return parties.value.filter((party) => leading.has(party));
});

const outlines = computed(() => {
  const drawn = [];
  if (picked.value)
    drawn.push({ key: "map-picked", d: picked.value.d, width: 2.5 });
  if (hovered.value && hovered.value.teryt !== picked.value?.teryt)
    drawn.push({ key: "map-hover", d: hovered.value.d, width: 1.5 });
  return drawn;
});

const fill = (item: { row: MapRow }) => {
  if (!hasParties.value) return peopleFill(item.row.people);
  if (mode.value === ALL_PARTIES) return leadFill(item.row);
  return shareFill(item.row, mode.value);
};

const title = (item: { name: string; row: MapRow }) =>
  regionTitle(item.name, item.row, hasParties.value ? mode.value : "");

/** A picked chip is a party chip (`partyChipPaint`); the others stay white
 * with the party's colour as a dot. */
const chipStyle = (party: string) =>
  mode.value === party ? partyChipPaint(party) : undefined;
const dotStyle = (party: string) => ({
  background: partyColors[party] ?? choropleth.tie,
});

/** On a phone the chips are one row that scrolls: its edges fade where more
 * chips are hidden. */
const switchEl = ref<{ $el: HTMLElement } | null>(null);
const edges = ref({ start: true, end: false });
const onScroll = (event: Event) => {
  const el = event.target as HTMLElement;
  edges.value = {
    start: el.scrollLeft <= 1,
    end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
  };
};
onMounted(() => {
  const container = switchEl.value?.$el.querySelector(
    ".v-slide-group__container",
  );
  if (!container) return;
  container.addEventListener("scroll", onScroll, { passive: true });
  onScroll({ target: container } as unknown as Event);
});

const emit = defineEmits(["click", "update:hovered"]);
const click = (region: Powiat) => {
  picked.value = region;
  emit("click", region);
};
</script>

<template>
  <div class="poland-map-container relative">
    <v-chip-group
      v-if="parties.length"
      ref="switchEl"
      v-model="mode"
      mandatory
      center-active
      scroll-to-active
      class="map-switch"
      :class="{
        'map-switch--more-before': !edges.start,
        'map-switch--more-after': !edges.end,
      }"
      aria-label="Kolory mapy"
      data-testid="map-switch"
    >
      <v-chip
        :value="ALL_PARTIES"
        :variant="mode === ALL_PARTIES ? 'flat' : 'outlined'"
        :color="mode === ALL_PARTIES ? 'ink-sage' : undefined"
        class="map-switch__chip"
      >
        Wszystkie
      </v-chip>
      <v-chip
        v-for="party in parties"
        :key="party"
        :value="party"
        :variant="mode === party ? 'flat' : 'outlined'"
        :style="chipStyle(party)"
        class="map-switch__chip"
      >
        <span
          v-if="mode !== party"
          class="map-switch__dot"
          :style="dotStyle(party)"
        />
        {{ partyLabel(party) }}
      </v-chip>
    </v-chip-group>
    <svg
      viewBox="0 0 800 744"
      xmlns="http://www.w3.org/2000/svg"
      class="w-full h-auto max-w-[800px] mx-auto"
      @mouseleave="hover(null)"
    >
      <g>
        <path
          v-for="item in powiaty"
          :key="item.teryt"
          :d="item.d"
          :fill="fill(item)"
          :stroke="choropleth.district"
          stroke-width="0.75"
          vector-effect="non-scaling-stroke"
          class="cursor-pointer"
          @mouseenter="hover(item)"
          @click="click(item)"
        >
          <title>{{ title(item) }}</title>
        </path>
      </g>
      <!-- Województwa Outlines -->
      <g class="pointer-events-none">
        <path
          v-for="(item, index) in wojewodztwaPaths"
          :key="'woj-' + (item.teryt || index)"
          :d="item.d"
          fill="none"
          :stroke="choropleth.voivodeship"
          stroke-width="1.25"
          vector-effect="non-scaling-stroke"
        />
      </g>
      <!-- The picked powiat and the one under the pointer, outlined on top
           of their neighbours: dark ink on a white halo, which reads on PiS's
           navy as on the palest step. The fill stays: a grey fill would hide
           the party. -->
      <g
        v-for="outline in outlines"
        :key="outline.key"
        class="pointer-events-none"
        :data-testid="outline.key"
      >
        <path
          :d="outline.d"
          fill="none"
          :stroke="choropleth.district"
          :stroke-width="outline.width + 2"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
        <path
          :d="outline.d"
          fill="none"
          :stroke="choropleth.hover"
          :stroke-width="outline.width"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      </g>
    </svg>
    <ChartMapLegend :mode="mode" :leaders="leaders" :fallback="!hasParties" />
  </div>
</template>

<style scoped>
.poland-map-container {
  width: 100%;
}

.map-switch {
  margin: 0 auto 8px;
  max-width: 720px;
}

.map-switch :deep(.v-chip.map-switch__chip) {
  margin: 4px;
  font-weight: 500;
}

/* Unpicked: a white chip on a hairline, not the outlined variant's full-ink
   border. */
.map-switch :deep(.v-chip--variant-outlined) {
  border-color: rgba(0, 0, 0, 0.16);
}

/* The group lays a translucent overlay over a picked chip, which lightened
   PiS's navy to #255286. As specific as Vuetify's rule, plus the group. */
.map-switch
  :deep(.v-chip.v-chip--selected:not(.v-chip--disabled) .v-chip__overlay) {
  opacity: 0;
}

.map-switch__dot {
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

/* On a computer every chip shows, wrapped and centred. */
@media (min-width: 600px) {
  .map-switch :deep(.v-slide-group__content) {
    flex: 1 1 auto;
    flex-wrap: wrap;
    justify-content: center;
    max-width: 100%;
    white-space: normal;
  }
}

/* On a phone one row scrolls; an edge fades where chips are hidden past it
   (decision on 2026-11-18). */
@media (max-width: 599.98px) {
  .map-switch--more-after :deep(.v-slide-group__container) {
    mask-image: linear-gradient(to right, black 85%, transparent);
  }

  .map-switch--more-before :deep(.v-slide-group__container) {
    mask-image: linear-gradient(to right, transparent, black 15%);
  }

  .map-switch--more-before.map-switch--more-after
    :deep(.v-slide-group__container) {
    mask-image: linear-gradient(
      to right,
      transparent,
      black 15%,
      black 85%,
      transparent
    );
  }
}
</style>
