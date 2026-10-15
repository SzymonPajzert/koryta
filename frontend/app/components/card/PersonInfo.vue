<template>
  <!-- On the person's own page: one quiet line under the name, „ur. 16
       stycznia 1975 · Wikipedia · Rejestr.io”. The label-over-value grid below
       took about 300px of a phone's first screen to say three things, each
       label in capitals over a value in the same grey. -->
  <p v-if="inline && hasFacts" class="person-facts" data-testid="person-facts">
    <span v-if="person?.birthDate" class="person-facts__item">
      {{ birthLabel }}
    </span>
    <!-- Labelled, as „ur.” labels the date: production's values are words
         like „prawnik” and „dziennikarz”, which bare read as the person's
         job on a page about the posts they hold. -->
    <span v-if="person?.education" class="person-facts__item">
      wykształcenie: {{ person.education }}
    </span>
    <!-- Underlined ink, as on a company's page: the theme's sage is 1.85:1 as
         text on white, and sage is a fill on this site, never ink. The line
         is under the name only - drawn on the link itself it ran under the
         middot before it too. -->
    <a
      v-for="link in links"
      :key="link.label"
      :href="link.url"
      target="_blank"
      class="person-facts__item person-facts__link"
    >
      <span class="person-facts__name">{{ link.label }}</span>
      <v-icon :icon="mdiOpenInNew" size="14" class="ml-1" aria-hidden="true" />
    </a>
  </p>

  <v-row v-else-if="!inline && hasFacts">
    <v-col v-if="person?.birthDate" cols="12" sm="4">
      <v-list-subheader class="px-0" style="min-height: 24px"
        >Data urodzenia</v-list-subheader
      >
      <div class="text-body-2 font-weight-medium">{{ person.birthDate }}</div>
    </v-col>

    <v-col v-if="person?.education" cols="12" sm="4">
      <v-list-subheader class="px-0" style="min-height: 24px"
        >Wykształcenie</v-list-subheader
      >
      <div class="text-body-2 font-weight-medium">{{ person.education }}</div>
    </v-col>

    <v-col v-if="person?.wikipedia" cols="12" sm="4">
      <v-list-subheader class="px-0" style="min-height: 24px"
        >Wikipedia</v-list-subheader
      >
      <a
        :href="person.wikipedia"
        target="_blank"
        class="text-primary text-decoration-none d-inline-flex align-center font-weight-medium"
      >
        Artykuł z Wikipedii
        <v-icon :icon="mdiOpenInNew" size="small" class="ml-1" />
      </a>
    </v-col>

    <v-col v-if="person?.rejestrIo" cols="12" sm="4">
      <v-list-subheader class="px-0" style="min-height: 24px"
        >Rejestr.io</v-list-subheader
      >
      <a
        :href="person.rejestrIo"
        target="_blank"
        class="text-primary text-decoration-none d-inline-flex align-center font-weight-medium"
      >
        Profil w rejestrze
        <v-icon :icon="mdiOpenInNew" size="small" class="ml-1" />
      </a>
    </v-col>

    <v-col v-if="person?.ktomaco" cols="12" sm="4">
      <v-list-subheader class="px-0" style="min-height: 24px"
        >Kto ma co</v-list-subheader
      >
      <a
        :href="person.ktomaco"
        target="_blank"
        class="text-primary text-decoration-none d-inline-flex align-center font-weight-medium"
      >
        Profil w Kto ma co
        <v-icon :icon="mdiOpenInNew" size="small" class="ml-1" />
      </a>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { mdiOpenInNew } from "@mdi/js";
import type { Person, PersonRich } from "~~/shared/model";
import { isoDay, longDate } from "~~/shared/dates";

const props = defineProps<{
  person: Person | PersonRich | undefined;
  /** One line of facts rather than a grid of labelled values: the person's
   * own page. The table's drawer and the triage cards keep the grid. */
  inline?: boolean;
}>();

const hasFacts = computed(
  () =>
    !!(
      props.person?.birthDate ||
      props.person?.education ||
      props.person?.wikipedia ||
      props.person?.rejestrIo ||
      props.person?.ktomaco
    ),
);

/** „ur. 16 stycznia 1975”. A birth date that is not a whole ISO day - a year
 * a register gave on its own, say - is printed as it was written rather than
 * turned into a 1 January nobody recorded. */
const birthLabel = computed(() => {
  const raw = props.person?.birthDate?.trim() ?? "";
  return `ur. ${isoDay(raw) ? longDate(raw) : raw}`;
});

/** The profiles elsewhere, named by the site they are on: the line says
 * where a link goes, and the arrow that it leaves koryta.pl. */
const links = computed(() =>
  [
    { label: "Wikipedia", url: props.person?.wikipedia },
    { label: "Rejestr.io", url: props.person?.rejestrIo },
    { label: "Kto ma co", url: props.person?.ktomaco },
  ].filter((link): link is { label: string; url: string } => !!link.url),
);
</script>

<style scoped>
/* A meta line: 14px in the quiet ink, the facts divided by a middot. The dot
   hangs in the column gap, left of the item it precedes, and the line clips
   what overflows it on the left - so an item that wraps to open a new line
   loses its dot instead of starting with one, and its own text never moves.
   The clip edge sits 4px out from the text, which the dot at -11px is past
   and a link's focus ring is not. At the bio's measure. */
.person-facts {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  column-gap: 17px;
  display: flex;
  flex-wrap: wrap;
  font-size: var(--k-ui-size);
  line-height: 1.45;
  margin: 0 0 0 -4px;
  max-width: calc(80ch + 4px);
  overflow-x: clip;
  padding-inline-start: 4px;
  row-gap: 2px;
}

.person-facts__item {
  min-width: 0;
  overflow-wrap: anywhere;
  position: relative;
}

/* The second `content` gives the dot an empty alternative text, so a screen
   reader does not read it into the link it hangs on („· Rejestr.io”). A
   browser without the syntax keeps the first. */
.person-facts__item + .person-facts__item::before {
  color: rgba(var(--v-theme-on-surface), 0.38);
  content: "·";
  content: "·" / "";
  left: -11px;
  position: absolute;
}

.person-facts__link {
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
}

.person-facts__name {
  text-decoration: underline;
  text-decoration-color: rgba(var(--v-theme-on-surface), 0.38);
  text-underline-offset: 3px;
}

.person-facts__link:hover,
.person-facts__link:focus-visible {
  color: rgba(var(--v-theme-on-surface), 0.87);
}

.person-facts__link:hover .person-facts__name,
.person-facts__link:focus-visible .person-facts__name {
  text-decoration-color: currentColor;
}
</style>
