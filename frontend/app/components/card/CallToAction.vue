<template>
  <v-container class=".align-center">
    <h3>Zostało nam jeszcze dużo osób</h3>
    <ChartPeopleProgress class="ma-2" />
    <v-row>
      <v-col cols="12">
        <v-card class="">
          <v-card-text>
            Nasza baza cały czas rośnie. Dołącz do grona wolontariuszy,
            analizujących dane lub promujących projekt. Dzięki osobom jak Ty,
            znaleźliśmy już {{ user ? "(nieoficjalnie) 4,500" : "200" }} osób.
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
          <v-icon>mdi-pencil-plus</v-icon> Chcę pomóc! (ankieta)
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
const { user } = useAuthState();
</script>
