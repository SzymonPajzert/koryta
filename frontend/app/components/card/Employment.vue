<template>
  <v-card
    :to="personUrl"
    :data-testid="`recent-employment-${employment.id}`"
    class="employment-card h-100"
    flat
    rounded="lg"
  >
    <div class="employment-card__body">
      <div class="d-flex align-start ga-3">
        <v-avatar class="employment-card__avatar" color="primary" size="40">
          <span class="text-body-2 font-weight-bold">{{ initials }}</span>
        </v-avatar>

        <div class="employment-card__who">
          <div class="employment-card__name text-subtitle-1 font-weight-bold">
            {{ employment.personName }}
          </div>
          <div class="employment-card__role text-body-2">
            {{ employment.role ?? "Zatrudniony/a w" }}
          </div>
        </div>

        <v-icon :icon="mdiArrowRight" class="employment-card__go" size="18" />
      </div>

      <div class="employment-card__company d-flex align-center ga-2">
        <v-icon :icon="mdiOfficeBuildingOutline" size="16" />
        <span class="text-body-2 font-weight-medium">{{
          employment.companyName
        }}</span>
      </div>

      <div class="d-flex align-center flex-wrap ga-2">
        <span
          class="employment-card__period text-caption d-inline-flex align-center ga-1"
          :class="{ 'employment-card__period--ongoing': ongoing }"
        >
          <v-icon :icon="mdiCalendarBlankOutline" size="13" />
          {{ period }}
        </span>
        <ChipPublicCompany :company="company" />
        <ChipCompanyCategories :company="company" />
        <PartyChip
          v-for="party in employment.parties"
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
  mdiArrowRight,
  mdiCalendarBlankOutline,
  mdiOfficeBuildingOutline,
} from "@mdi/js";
import { generateEntityUrl } from "~/composables/slugs";
import type { Company } from "~~/shared/model";
import type { RecentEmployment } from "~~/server/api/edges/recentEmployments.get";

const props = defineProps<{ employment: RecentEmployment }>();

/** The person, not the company. The card is about a job, but the reader
 * clicking it wants to know who this is - the company is one hop further on
 * from their page, and every other route into the site already leads to a
 * person. */
const personUrl = computed(() =>
  generateEntityUrl(
    "person",
    props.employment.personId,
    props.employment.personName,
  ),
);

/** Stands in for a photograph nobody has. Two letters at most, so a name with
 * a middle one or a double surname does not fill the circle. */
const initials = computed(() =>
  props.employment.personName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join(""),
);

/** The company chips read the whole company because a caller may be holding
 * something that is not one. Here it always is, so this is only the fields they
 * actually look at, put back into the shape they expect. */
const company = computed<Company>(() => ({
  type: "place",
  name: props.employment.companyName,
  isPublic: props.employment.companyIsPublic,
  isPublicSource: props.employment.companyIsPublicSource,
  categories: props.employment.companyCategories,
}));

/** Whether the post is still held, which is what tints the date. A spell that
 * began and ended on the same day is over, so it is the equality rather than
 * the missing end that decides. */
const ongoing = computed(() => props.employment.end_date === null);

/** "2024-03-01 - obecnie", and the single date where a spell began and ended
 * on the same day. A missing end means the post is still held; a missing start
 * cannot happen here, because the feed is ordered on it. */
const period = computed(() => {
  const { start_date: start, end_date: end } = props.employment;
  if (end === start) return start;
  return `${start} - ${end ?? "obecnie"}`;
});
</script>

<style scoped>
/* A feed of twenty of these, so the card is a quiet white surface with one
   accent rather than the tonal block the rest of the home page uses: stacked,
   those read as a wall. Depth is kept for the hover, which is the only thing
   here that has to say "this is a link". */
.employment-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  overflow: hidden;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

/* The accent, drawn rather than given to the border so only one edge carries
   it. Full height of the card whatever the name and role wrap to. */
.employment-card::before {
  background: rgb(var(--v-theme-primary));
  bottom: 0;
  content: "";
  left: 0;
  position: absolute;
  top: 0;
  width: 4px;
}

.employment-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.9);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.09);
  transform: translateY(-2px);
}

/* Vuetify's own hover overlay on top of a near-white surface is a grey wash
   that fights the lift above. */
.employment-card :deep(.v-card__overlay) {
  display: none;
}

.employment-card__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 16px 16px 20px;
}

/* Without this the flex item is free to size to its longest word, and an
   unbroken company name or url widens the card past its grid column. */
.employment-card__who {
  flex: 1 1 auto;
  min-width: 0;
}

.employment-card__name {
  line-height: 1.3;
}

.employment-card__role {
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.employment-card__company {
  color: rgba(var(--v-theme-on-surface), 0.86);
}

/* Present at rest so the card reads as a link before the pointer is anywhere
   near it, and only earns its colour on hover. */
.employment-card__go {
  align-self: center;
  color: rgba(var(--v-theme-on-surface), 0.28);
  transition:
    color 0.2s ease,
    transform 0.2s ease;
}

.employment-card:hover .employment-card__go {
  color: rgb(var(--v-theme-primary));
  transform: translateX(3px);
}

/* A pill, so the date sits on the same line as the chips without looking like
   a caption that fell into them. */
.employment-card__period {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  padding: 2px 8px;
  white-space: nowrap;
}

/* The one thing a reader scanning the feed is looking for: which of these
   people is sitting in the post right now. */
.employment-card__period--ongoing {
  background: rgba(var(--v-theme-primary), 0.22);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 600;
}
</style>
