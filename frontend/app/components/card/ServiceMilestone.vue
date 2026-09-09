<template>
  <v-card
    :to="personUrl"
    :data-testid="`service-milestone-${milestone.id}`"
    class="milestone-card h-100"
    :class="{ 'milestone-card--past': past }"
    flat
    rounded="lg"
  >
    <div class="milestone-card__body">
      <div class="d-flex align-start ga-3">
        <v-avatar class="milestone-card__avatar" color="primary" size="40">
          <span class="text-body-2 font-weight-bold">{{ initials }}</span>
        </v-avatar>

        <div class="milestone-card__who">
          <div class="milestone-card__name text-subtitle-1 font-weight-bold">
            {{ milestone.personName }}
          </div>
          <div class="milestone-card__role text-body-2">
            {{ milestone.role ?? "Zatrudniony/a w" }}
          </div>
        </div>

        <!-- The one number the page exists for, so it takes the corner the
             feed on the home page gives to a bare arrow. -->
        <span
          class="milestone-card__years text-caption font-weight-bold"
          :title="yearsTitle"
        >
          {{ yearsLabel }}
        </span>
      </div>

      <!-- Where they were serving that day, not where the whole total was
           earned: the total is spread over `institutions` of them and the
           chip below says how many. -->
      <div class="milestone-card__company d-flex align-center ga-2">
        <v-icon :icon="mdiOfficeBuildingOutline" size="16" />
        <!-- The wrapping happens in here rather than on the row, so that a
             three-line institution name cannot leave the icon stranded on a
             line of its own. The two spans are siblings with a gap between
             them because inside one span the template collapses the newline
             and the card reads „…(Kamienna Góra)i jeszcze 1 stanowisko”. -->
        <div class="d-flex flex-wrap align-baseline ga-1 min-width-0">
          <span class="text-body-2 font-weight-medium">{{
            milestone.companyName
          }}</span>
          <span
            v-if="milestone.alsoHeld"
            class="text-body-2 text-medium-emphasis"
            >{{ alsoHeld }}</span
          >
        </div>
      </div>

      <div class="d-flex align-center flex-wrap ga-2">
        <span
          class="milestone-card__when text-caption d-inline-flex align-center ga-1"
          :class="{ 'milestone-card__when--soon': !past }"
        >
          <v-icon :icon="mdiCalendarStar" size="13" />
          {{ longDate(milestone.date) }} · {{ relative }}
        </span>
        <!-- What makes this a total rather than a job anniversary. -->
        <span
          class="milestone-card__spread text-caption d-inline-flex align-center ga-1"
          :title="spreadTitle"
        >
          <v-icon :icon="mdiBriefcaseOutline" size="13" />
          {{ spread }}
        </span>
        <!-- Only where the career has a gap, because only then is the date
             something other than an anniversary of the first day. -->
        <span
          v-if="milestone.spells > 1"
          class="milestone-card__gap text-caption d-inline-flex align-center ga-1"
          title="Staż liczony z przerwami - przerwy nie wliczają się, więc ta data jest późniejsza niż rocznica pierwszego dnia pracy"
        >
          <v-icon :icon="mdiCallSplit" size="13" />
          {{ spellsLabel }}
        </span>
        <ChipPublicCompany :company="company" />
        <PartyChip
          v-for="party in milestone.parties"
          :key="party"
          :party
          class="text-caption"
        />
      </div>
    </div>
  </v-card>
</template>

<script lang="ts" setup>
import {
  mdiBriefcaseOutline,
  mdiCalendarStar,
  mdiCallSplit,
  mdiOfficeBuildingOutline,
} from "@mdi/js";
import { generateEntityUrl } from "~/composables/slugs";
import { polishCounting } from "~/composables/polish";
import { longDate } from "~~/shared/dates";
import type { Company } from "~~/shared/model";
import type { ServiceMilestone } from "~~/server/api/edges/serviceMilestones.get";

const props = defineProps<{ milestone: ServiceMilestone }>();

/** The person, not the company - the same choice `CardEmployment` makes, and
 * for the same reason: the card is about a post, but the reader clicking it
 * wants to know who this is. */
const personUrl = computed(() =>
  generateEntityUrl(
    "person",
    props.milestone.personId,
    props.milestone.personName,
  ),
);

/** Stands in for a photograph nobody has. Two letters at most, so a name with
 * a middle one or a double surname does not fill the circle. */
const initials = computed(() =>
  props.milestone.personName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join(""),
);

/** Whether the day has gone by. Today is not past: it is the one card on the
 * page that is happening now, and it keeps the accent. */
const past = computed(() => props.milestone.daysFromToday < 0);

/** „dzisiaj”, „jutro”, „za 22 dni”, „12 dni temu”.
 *
 * `polishCounting` rather than `Intl.RelativeTimeFormat`, which would do the
 * numbered cases on its own but has no way to be told that the three days
 * either side of today should read as words - and those are the cards a reader
 * scanning this feed is looking for. */
const relative = computed(() => {
  const days = props.milestone.daysFromToday;
  if (days === 0) return "dzisiaj";
  if (days === 1) return "jutro";
  if (days === -1) return "wczoraj";
  const counted = polishCounting(Math.abs(days), "dzień", "dni", "dni");
  return days > 0 ? `za ${counted}` : `${counted} temu`;
});

/** „10 lat pracy”. */
const yearsLabel = computed(() =>
  polishCounting(props.milestone.years, "rok pracy", "lata pracy", "lat pracy"),
);

/** Whether the date is a fact or a projection, and it is only ever said in the
 * tooltip.
 *
 * Not a badge on the card, because it would be on every card in the upcoming
 * half and none in the past one: a milestone still ahead can only be reached
 * in a post nobody has closed, so „prognoza” beside all of them says no more
 * than the toggle above them already does. The page says it once instead. */

const yearsTitle = computed(() =>
  props.milestone.projected
    ? "Łączny staż w instytucjach publicznych osiągnie tę wartość, jeśli osoba pozostanie na stanowisku"
    : "Łączny staż w instytucjach publicznych osiągnął tę wartość tego dnia",
);

/** „w 4 instytucjach”, or „w jednej instytucji” where the whole total was
 * earned in one place - which is worth saying out loud on a site about people
 * who collect posts. */
const spread = computed(() => {
  const count = props.milestone.institutions;
  if (count <= 1) return "w jednej instytucji";
  return `w ${polishCounting(count, "instytucji", "instytucjach", "instytucjach")}`;
});

const spreadTitle = computed(
  () =>
    "Liczba instytucji publicznych, z których składa się ten staż. " +
    "Równoległe stanowiska liczą się raz.",
);

/** „z 3 okresów”: how many separate stretches of service the total is made of.
 * Only drawn when there is more than one. */
const spellsLabel = computed(
  () =>
    `z ${polishCounting(props.milestone.spells, "okresu", "okresów", "okresów")}`,
);

/** „i jeszcze 2 stanowiska”, for the posts held alongside the one named above.
 *
 * The noun is spelled out rather than left as a bare „i 2 inne”, which has
 * nothing to agree with and reads as an unfinished sentence. */
const alsoHeld = computed(
  () =>
    `i jeszcze ${polishCounting(
      props.milestone.alsoHeld,
      "stanowisko",
      "stanowiska",
      "stanowisk",
    )}`,
);

/** `ChipPublicCompany` reads the whole company because a caller may be holding
 * something that is not one. Here it always is, so this is only the two flags
 * it actually looks at, put back into the shape it expects. */
const company = computed<Company>(() => ({
  type: "place",
  name: props.milestone.companyName,
  isPublic: props.milestone.companyIsPublic,
  isPublicSource: props.milestone.companyIsPublicSource,
}));
</script>

<style scoped>
/* Deliberately `CardEmployment`'s card, down to the accent bar and the lift on
   hover: this feed is read the same way the home page's is, and two grids of
   near-identical rows that disagree about their border radius read as two
   half-finished features rather than as one site. */
.milestone-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  overflow: hidden;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.milestone-card::before {
  background: rgb(var(--v-theme-primary));
  bottom: 0;
  content: "";
  left: 0;
  position: absolute;
  top: 0;
  width: 4px;
}

/* The half of the feed that has already happened, dimmed at the one place a
   reader scanning it looks first. Only the bar: fading the text would make a
   perfectly readable card look disabled, and every one of these is a live link
   to a person's page. */
.milestone-card--past::before {
  background: rgba(var(--v-theme-on-surface), 0.22);
}

.milestone-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.9);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.09);
  transform: translateY(-2px);
}

/* Vuetify's own hover overlay on top of a near-white surface is a grey wash
   that fights the lift above. */
.milestone-card :deep(.v-card__overlay) {
  display: none;
}

.milestone-card__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 16px 16px 20px;
}

/* Without this the flex item is free to size to its longest word, and an
   unbroken company name or url widens the card past its grid column. */
.milestone-card__who {
  flex: 1 1 auto;
  min-width: 0;
}

.milestone-card__name {
  line-height: 1.3;
}

.milestone-card__role {
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.milestone-card__company {
  color: rgba(var(--v-theme-on-surface), 0.86);
}

/* A flex item's automatic minimum size is its min-content, so one unbroken
   institution name would widen the card past its grid column. */
.milestone-card__company .min-width-0 {
  min-width: 0;
}

/* Never wraps: „10. rocznica” breaking after the number reads as two facts. */
.milestone-card__years {
  align-self: flex-start;
  background: rgba(var(--v-theme-primary), 0.22);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.87);
  flex: 0 0 auto;
  padding: 3px 8px;
  white-space: nowrap;
}

.milestone-card--past .milestone-card__years {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.milestone-card__when,
.milestone-card__spread,
.milestone-card__gap {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  padding: 2px 8px;
  white-space: nowrap;
}

/* The one thing a reader scanning the feed is looking for: which of these is
   still to come. Same treatment `CardEmployment` gives a post still held. */
.milestone-card__when--soon {
  background: rgba(var(--v-theme-primary), 0.22);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 600;
}
</style>
