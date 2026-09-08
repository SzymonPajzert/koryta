<template>
  <v-card
    class="h-100 pa-4 d-flex flex-column"
    variant="outlined"
    rounded="lg"
    :data-testid="`story-cluster-${cluster.id}`"
  >
    <div class="d-flex align-start ga-2 mb-1">
      <div class="flex-grow-1">
        <h3 class="text-title-2 font-weight-bold lh-title">
          {{ cluster.title }}
        </h3>
        <div v-if="cluster.subtitle" class="text-caption text-medium-emphasis">
          właściciel: {{ cluster.subtitle }}
        </div>
      </div>
      <v-chip size="small" variant="tonal" :color="kindColor">
        {{ kindLabel }}
      </v-chip>
    </div>

    <!-- The claim, in one sentence, before any of the numbers that support it.
         Somebody scrolling the home page reads this line and nothing else. -->
    <p class="text-body-2 mb-2" data-testid="story-cluster-lede">
      {{ lede }}
    </p>

    <div
      v-if="partyChips.length"
      class="d-flex align-center flex-wrap ga-2 mb-2"
    >
      <PartyChip v-for="party in partyChips" :key="party" :party />
    </div>

    <ul class="hires mb-2">
      <li v-for="hire in shownHires" :key="hire.edgeId" class="text-body-2">
        <NuxtLink :to="personUrl(hire)" class="text-decoration-none">
          {{ hire.personName }}
        </NuxtLink>
        <span class="text-medium-emphasis">
          — {{ hire.companyName }}, {{ hire.start }}
        </span>
      </li>
    </ul>

    <!-- What makes the group legible rather than merely unlikely: the people
         who turn up in more than one of its companies, and the ones who stood
         for election in the same town. Both are omitted when absent, rather
         than printed as a zero. -->
    <p v-if="crewLine" class="text-caption text-medium-emphasis mb-1">
      {{ crewLine }}
    </p>
    <p v-if="localLine" class="text-caption text-medium-emphasis mb-1">
      {{ localLine }}
    </p>

    <v-spacer />

    <div class="d-flex flex-wrap ga-2 mt-2">
      <v-btn
        v-if="tableLink"
        :append-icon="mdiTable"
        size="small"
        variant="text"
        class="text-none"
        :to="tableLink"
        text="Zobacz w tabeli"
      />
      <v-btn
        v-if="nodeLink"
        size="small"
        variant="text"
        class="text-none"
        :to="nodeLink"
        :text="nodeLinkText"
      />
    </div>
  </v-card>
</template>

<script lang="ts" setup>
import { mdiTable } from "@mdi/js";
import { generateEntityUrl } from "~/composables/slugs";
import { polishCounting } from "~/composables/polish";
import {
  clusterTableLink,
  type ClusterHireRef,
  type StoryCluster,
} from "~~/shared/clusters";

const props = defineProps<{ cluster: StoryCluster }>();

/** How many hires the card lists before it stops. Four: the card sits in a
 * two-column grid beside three others, and a fifth line pushes the buttons
 * below the fold on a phone. */
const MAX_HIRES = 4;

const kindLabels: Record<StoryCluster["kind"], string> = {
  region: "miasto lub powiat",
  sector: "branża",
  owner: "grupa spółek",
};
const kindColors: Record<StoryCluster["kind"], string> = {
  region: "primary",
  sector: "secondary",
  owner: "info",
};
const kindLabel = computed(() => kindLabels[props.cluster.kind]);
const kindColor = computed(() => kindColors[props.cluster.kind]);

const shownHires = computed(() => props.cluster.hires.slice(0, MAX_HIRES));

/** Parties worth a chip: the ones actually holding seats here, biggest first,
 * capped so a mixed cluster does not become a row of chips. */
const partyChips = computed(() =>
  Object.entries(props.cluster.partyMix)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([party]) => party),
);

/** The sentence the card is for.
 *
 * Built from whichever channel put the cluster on the list, because they are
 * different claims: a party cluster is „ten of the fourteen we could label are
 * PiS”, a rollout is „six of nine had their boards replaced inside nine
 * months”, and a burst is „twice as many changes as this place usually has”.
 * Printing all three would bury whichever one is true.
 */
const lede = computed(() => {
  const c = props.cluster;
  const changes = `${polishCounting(c.known, "zmiana", "zmiany", "zmian")} w ${polishCounting(c.companies, "spółce", "spółkach", "spółkach")}`;

  /* `channels` rather than a threshold re-derived here: the card must not be
   * able to disagree with the detector about what put the cluster on the list.
   * And not the party claim where it only holds among the people an editor has
   * already published - that sentence would be a description of the queue. */
  if (
    c.channels.includes("party") &&
    !c.partyIsEditorialArtifact &&
    c.dominantParty
  ) {
    return (
      `${changes}. ${c.dominantCount} z ${c.labelled} osób, którym znamy partię, to ` +
      `${c.dominantParty} — ${times(c.partyLift)} częściej niż w spółkach ` +
      `z takim samym właścicielem w całym kraju.`
    );
  }
  /* Before the rollout and the burst, because where both hold this is the more
   * particular claim: „a fifth of the people arriving here are political” says
   * more than „there were more arrivals than usual”. */
  if (c.channels.includes("density")) {
    return (
      `${changes}. ${c.density} z ${c.densityOf} osób, których stron jeszcze ` +
      `nie opublikowaliśmy, ma za sobą partię albo start w wyborach — ` +
      `${times(c.densityLift)} częściej niż w spółkach z takim samym ` +
      `właścicielem.`
    );
  }
  if (c.channels.includes("sweep")) {
    return (
      `${changes}. W ${c.swept} z tych spółek wymieniono kilka osób naraz` +
      `${c.rolloutPerMonth >= 0.5 ? ", jedną spółkę po drugiej" : ""} — ` +
      `spodziewaliśmy się ${decimal(c.sweepExpected)}.`
    );
  }
  if (c.channels.includes("burst")) {
    return `${changes} — ${times(c.burstLift)} więcej niż zwykle w tym miejscu.`;
  }
  if (c.localCandidates > 0) {
    return (
      `${changes}. ${c.localCandidates} z nich to osoby, które kandydowały tu ` +
      `w wyborach — spodziewaliśmy się ${decimal(c.localExpected)}.`
    );
  }
  return changes + ".";
});

/** A decimal with the separator Polish uses. `Intl` would do it, but for one
 * number with one decimal place it would be a formatter per card. */
function decimal(value: number): string {
  return String(value).replace(".", ",");
}

/** „trzy razy” reads better than „3,03x” on a card, and the precision was
 * never real: the lift is an estimate with an interval around it. */
function times(lift: number): string {
  const rounded = Math.round(lift);
  if (lift < 1.75) return "częściej";
  if (rounded === 2) return "dwa razy";
  if (rounded === 3) return "trzy razy";
  if (rounded === 4) return "cztery razy";
  return `${rounded} razy`;
}

const crewLine = computed(() => {
  const crew = props.cluster.crew.slice(0, 3);
  if (!crew.length) return "";
  const names = crew
    .map((member) => `${member.personName} (${member.companies})`)
    .join(", ");
  return `W kilku spółkach naraz: ${names}.`;
});

const localLine = computed(() => {
  const count = props.cluster.localCandidates;
  if (!count || props.cluster.channels.includes("local")) return "";
  return `${polishCounting(count, "osoba kandydowała", "osoby kandydowały", "osób kandydowało")} tu w wyborach.`;
});

function personUrl(hire: ClusterHireRef) {
  return generateEntityUrl("person", hire.personId, hire.personName);
}

const tableLink = computed(() => clusterTableLink(props.cluster));

const nodeLink = computed(() => {
  const c = props.cluster;
  if (!c.nodeId) return "";
  if (c.kind === "region") {
    return generateEntityUrl("region", c.nodeId, c.title);
  }
  return generateEntityUrl("place", c.nodeId, c.subtitle ?? c.title);
});

const nodeLinkText = computed(() =>
  props.cluster.kind === "region" ? "Strona regionu" : "Strona właściciela",
);
</script>

<style scoped>
.hires {
  list-style: none;
  padding: 0;
}

.hires li {
  padding: 2px 0;
}
</style>
