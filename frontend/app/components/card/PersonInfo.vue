<template>
  <!-- On the person's own page: one line under the name, „ur. 16 stycznia
       1975 · Wikipedia ↗ · Rejestr.io ↗”, in the facts line a company's page
       has too (entity/Facts.vue). The label-over-value grid below took about
       300px of a phone's first screen to say three things, each label in
       capitals over a value in the same grey. -->
  <EntityFacts
    v-if="inline && hasFacts"
    :facts="facts"
    data-testid="person-facts"
  />

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
import type { EntityFact } from "~/components/entity/Facts.vue";

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

/** The line's facts: when they were born and what they studied, then their
 * profiles elsewhere. A birth date that is not a whole ISO day - a year a
 * register gave on its own, say - is printed as it was written rather than
 * turned into a 1 January nobody recorded. Education is labelled, as „ur.”
 * labels the date: production's values are words like „prawnik” and
 * „dziennikarz”, which bare read as the person's job on a page about the posts
 * they hold. A profile is named by the site it is on: the line says where a
 * link goes, and the arrow that it leaves koryta.pl. */
const facts = computed<EntityFact[]>(() => {
  const person = props.person;
  const birthDate = person?.birthDate?.trim();
  return [
    ...(birthDate
      ? [
          {
            key: "birth",
            label: "ur.",
            value: isoDay(birthDate) ? longDate(birthDate) : birthDate,
          },
        ]
      : []),
    ...(person?.education
      ? [
          {
            key: "education",
            label: "wykształcenie:",
            value: person.education,
          },
        ]
      : []),
    ...[
      { key: "wikipedia", value: "Wikipedia", url: person?.wikipedia },
      { key: "rejestrIo", value: "Rejestr.io", url: person?.rejestrIo },
      { key: "ktomaco", value: "Kto ma co", url: person?.ktomaco },
    ].filter((link) => !!link.url),
  ];
});
</script>
