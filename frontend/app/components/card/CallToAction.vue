<template>
  <v-container class=".align-center">
    <h3>Zostało nam jeszcze dużo osób</h3>
    <PeopleProgress />
    <v-row>
      <v-col cols="12">
        <v-card class="">
          <v-card-text>
            Nasza baza cały czas rośnie. Dołącz do grona wolontariuszy,
            analizujących dane i promujących projekt. Dzięki osobom jak Ty,
            znaleźliśmy już 200 osób.
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="6" class="text-center">
        <v-btn
          variant="elevated"
          color="primary"
          class="ma-2"
          href="https://www.guidedtrack.com/programs/9fk0fj2/run"
          target="_blank"
        >
          <v-icon>mdi-pencil-plus</v-icon> Wypełnij ankietę
        </v-btn>
      </v-col>
      <v-col cols="12" md="6" class="text-center">
        <v-btn variant="elevated" color="primary" class="ma-2" to="/pomoc">
          <v-icon>mdi-hand</v-icon> Albo zacznij działać
        </v-btn>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
// TODO why do I need to import it?
import PeopleProgress from "../chart/PeopleProgress.vue";
</script>
