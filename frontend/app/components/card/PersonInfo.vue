<template>
  <v-row v-if="person?.birthDate || person?.wikipedia || person?.rejestrIo">
    <v-col v-if="person?.birthDate" cols="12" sm="4">
      <v-list-subheader
        class="px-0 text-uppercase font-weight-bold"
        style="min-height: 24px"
        >Data urodzenia</v-list-subheader
      >
      <div class="text-body-1">{{ person.birthDate }}</div>
    </v-col>

    <v-col v-if="person?.wikipedia" cols="12" sm="4">
      <v-list-subheader
        class="px-0 text-uppercase font-weight-bold"
        style="min-height: 24px"
        >Wikipedia</v-list-subheader
      >
      <a
        :href="person.wikipedia"
        target="_blank"
        class="text-primary text-decoration-none d-inline-flex align-center"
      >
        Artykuł z Wikipedii
        <v-icon icon="mdi-open-in-new" size="small" class="ml-1" />
      </a>
    </v-col>

    <v-col v-if="person?.rejestrIo" cols="12" sm="4">
      <v-list-subheader
        class="px-0 text-uppercase font-weight-bold"
        style="min-height: 24px"
        >Rejestr.io</v-list-subheader
      >
      <a
        :href="person.rejestrIo"
        target="_blank"
        class="text-primary text-decoration-none d-inline-flex align-center"
      >
        Profil w rejestrze
        <v-icon icon="mdi-open-in-new" size="small" class="ml-1" />
      </a>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import type { Person, PersonRich } from "~~/shared/model";

defineProps<{
  person: Person | PersonRich | undefined;
}>();
</script>
