<template>
  <PeopleProgress />
  <v-row>
    <v-col cols="12" md="6" class="text-center">
      <v-btn
        variant="elevated"
        color="primary"
        class="ma-2"
        href="https://www.guidedtrack.com/programs/9fk0fj2/run"
        target="_none"
      >
        <v-icon>mdi-hand</v-icon> Zgłoś się do pomocy
      </v-btn>
    </v-col>
    <v-col cols="12" md="6" class="text-center">
      <v-btn variant="elevated" color="primary" class="ma-2" to="/pomoc">
        Albo zacznij działać
      </v-btn>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
// TODO why do I need to import it?
import PeopleProgress from "../chart/PeopleProgress.vue";
</script>
