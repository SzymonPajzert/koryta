<template>
  <v-card
    :to="personUrl"
    :data-testid="`work-anniversary-${anniversary.id}`"
    class="anniversary-card h-100"
    :class="{ 'anniversary-card--past': past }"
    flat
    rounded="lg"
  >
    <div class="anniversary-card__body">
      <div class="d-flex align-start ga-3">
        <v-avatar class="anniversary-card__avatar" color="primary" size="40">
          <span class="text-body-2 font-weight-bold">{{ initials }}</span>
        </v-avatar>

        <div class="anniversary-card__who">
          <div class="anniversary-card__name text-subtitle-1 font-weight-bold">
            {{ anniversary.personName }}
          </div>
          <div class="anniversary-card__role text-body-2">
            {{ anniversary.role ?? "Zatrudniony/a w" }}
          </div>
        </div>

        <!-- The one number the page exists for, so it takes the corner the
             feed on the home page gives to a bare arrow. -->
        <span
          class="anniversary-card__years text-caption font-weight-bold"
          :title="`Stanowisko objęte ${longDate(anniversary.start_date)}`"
        >
          {{ anniversary.years }}. rocznica
        </span>
      </div>

      <div class="anniversary-card__company d-flex align-center ga-2">
        <v-icon :icon="mdiOfficeBuildingOutline" size="16" />
        <span class="text-body-2 font-weight-medium">{{
          anniversary.companyName
        }}</span>
      </div>

      <div class="d-flex align-center flex-wrap ga-2">
        <span
          class="anniversary-card__when text-caption d-inline-flex align-center ga-1"
          :class="{ 'anniversary-card__when--soon': !past }"
        >
          <v-icon :icon="mdiCalendarStar" size="13" />
          {{ longDate(anniversary.date) }} · {{ relative }}
        </span>
        <!-- The sum the reader was promised, and it is not `years` above: this
             one adds up every post the person holds or has held in a public
             institution, that one is this post alone. -->
        <span
          v-if="experience"
          class="anniversary-card__experience text-caption d-inline-flex align-center ga-1"
          title="Łączny staż we wszystkich instytucjach publicznych"
        >
          <v-icon :icon="mdiBriefcaseOutline" size="13" />
          łącznie {{ experience }}
        </span>
        <ChipPublicCompany :company="company" />
        <PartyChip
          v-for="party in anniversary.parties"
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
  mdiOfficeBuildingOutline,
} from "@mdi/js";
import { generateEntityUrl } from "~/composables/slugs";
import { polishCounting } from "~/composables/polish";
import { longDate } from "~~/shared/dates";
import type { Company } from "~~/shared/model";
import type { WorkAnniversary } from "~~/server/api/edges/anniversaries.get";

const props = defineProps<{ anniversary: WorkAnniversary }>();

/** The person, not the company - the same choice `CardEmployment` makes, and
 * for the same reason: the card is about a post, but the reader clicking it
 * wants to know who this is. */
const personUrl = computed(() =>
  generateEntityUrl(
    "person",
    props.anniversary.personId,
    props.anniversary.personName,
  ),
);

/** Stands in for a photograph nobody has. Two letters at most, so a name with
 * a middle one or a double surname does not fill the circle. */
const initials = computed(() =>
  props.anniversary.personName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join(""),
);

/** Whether the day has gone by. Today is not past: it is the one card on the
 * page that is happening now, and it keeps the accent. */
const past = computed(() => props.anniversary.daysFromToday < 0);

/** „dzisiaj”, „jutro”, „za 22 dni”, „12 dni temu”.
 *
 * `polishCounting` rather than `Intl.RelativeTimeFormat`, which would do the
 * numbered cases on its own but has no way to be told that the three days
 * either side of today should read as words - and those are the cards a reader
 * scanning this feed is looking for. Having chosen the noun forms by hand for
 * the rest, they come from the same helper every other count on the site
 * does. */
const relative = computed(() => {
  const days = props.anniversary.daysFromToday;
  if (days === 0) return "dzisiaj";
  if (days === 1) return "jutro";
  if (days === -1) return "wczoraj";
  const counted = polishCounting(Math.abs(days), "dzień", "dni", "dni");
  return days > 0 ? `za ${counted}` : `${counted} temu`;
});

/** The career total, rounded to whole years.
 *
 * „poniżej roku” below one rather than „0 lat pracy”, and whole years above
 * it, because that is what /eksploruj/tabela settled on when the same figure
 * printed as „12.4 lat pracy” - a decimal point where Polish writes a comma,
 * and the wrong noun form after a fraction. Empty where the stats say nothing,
 * which hides the pill rather than printing a zero. */
const experience = computed(() => {
  const years = props.anniversary.experienceYears;
  if (!years) return "";
  if (years < 1) return "poniżej roku";
  return polishCounting(
    Math.round(years),
    "rok pracy",
    "lata pracy",
    "lat pracy",
  );
});

/** `ChipPublicCompany` reads the whole company because a caller may be holding
 * something that is not one. Here it always is, so this is only the two flags
 * it actually looks at, put back into the shape it expects. */
const company = computed<Company>(() => ({
  type: "place",
  name: props.anniversary.companyName,
  isPublic: props.anniversary.companyIsPublic,
  isPublicSource: props.anniversary.companyIsPublicSource,
}));
</script>

<style scoped>
/* Deliberately `CardEmployment`'s card, down to the accent bar and the lift on
   hover: this feed is read the same way the home page's is, and two grids of
   near-identical rows that disagree about their border radius read as two
   half-finished features rather than as one site. */
.anniversary-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  overflow: hidden;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.anniversary-card::before {
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
.anniversary-card--past::before {
  background: rgba(var(--v-theme-on-surface), 0.22);
}

.anniversary-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.9);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.09);
  transform: translateY(-2px);
}

/* Vuetify's own hover overlay on top of a near-white surface is a grey wash
   that fights the lift above. */
.anniversary-card :deep(.v-card__overlay) {
  display: none;
}

.anniversary-card__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 16px 16px 20px;
}

/* Without this the flex item is free to size to its longest word, and an
   unbroken company name or url widens the card past its grid column. */
.anniversary-card__who {
  flex: 1 1 auto;
  min-width: 0;
}

.anniversary-card__name {
  line-height: 1.3;
}

.anniversary-card__role {
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.anniversary-card__company {
  color: rgba(var(--v-theme-on-surface), 0.86);
}

/* Never wraps: „10. rocznica” breaking after the number reads as two facts. */
.anniversary-card__years {
  align-self: flex-start;
  background: rgba(var(--v-theme-primary), 0.22);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.87);
  flex: 0 0 auto;
  padding: 3px 8px;
  white-space: nowrap;
}

.anniversary-card--past .anniversary-card__years {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.anniversary-card__when,
.anniversary-card__experience {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  padding: 2px 8px;
  white-space: nowrap;
}

/* The one thing a reader scanning the feed is looking for: which of these is
   still to come. Same treatment `CardEmployment` gives a post still held. */
.anniversary-card__when--soon {
  background: rgba(var(--v-theme-primary), 0.22);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 600;
}
</style>
