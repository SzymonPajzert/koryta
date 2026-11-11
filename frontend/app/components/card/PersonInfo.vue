<template>
  <v-row
    v-if="
      person?.birthDate ||
      person?.education ||
      person?.wikipedia ||
      person?.rejestrIo ||
      person?.ktomaco
    "
  >
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

defineProps<{
  person: Person | PersonRich | undefined;
}>();
</script>
