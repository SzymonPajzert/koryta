<template>
  <v-container class="text-center d-flex flex-column align-center">
    <h3>Zostało nam jeszcze dużo osób</h3>
    <ChartPeopleProgress class="my-4 mx-auto" />
    <v-row>
      <v-col cols="12">
        <v-card class="">
          <v-card-text>
            Nasza baza cały czas rośnie. Dołącz do grona wolontariuszy,
            analizujących dane lub promujących projekt. Dzięki osobom jak Ty,
            znaleźliśmy już {{ interesting }} osób.
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="6" class="text-center">
        <v-btn
          variant="elevated"
          color="primary"
          class="ma-2"
          href="https://docs.google.com/forms/d/e/1FAIpQLSfZX4ekzLEhX60f6Frn3JMKkYwbqG2tE1NNNN0Eu_Ozr814FQ/viewform"
          target="_blank"
        >
          <v-icon :icon="mdiPencilPlus" /> Chcę pomóc! (ankieta)
        </v-btn>
      </v-col>
      <v-col cols="12" md="6" class="text-center">
        <v-btn variant="elevated" color="primary" class="ma-2" to="/pomoc">
          Albo zacznij działać
        </v-btn>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { mdiPencilPlus } from "@mdi/js";
import { useStats } from "~/composables/stats/useStats";

const { interesting } = useStats();
</script>
