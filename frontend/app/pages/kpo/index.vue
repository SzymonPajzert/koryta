<template>
  <div>
    <v-row>
      <v-col cols="12" md="6">
        <v-card class="ma-1 pa-3" height="100%">
          <v-card-title class="pa-0 ma-2" align="center">
            <div class="text-h5 font-weight-bold text-primary">Krajowy Plan Odbudowy</div>
          </v-card-title>
          <a
            href="https://www.rp.pl/polityka/art42828261-gdzie-trafia-pieniadze-z-kpo-wnioski-zlozone-o-dofinansowanie-jachtow-basenow-i-ekspresow-do-kawy"
            target="_none"
            >Rzeczpospolita</a
          >: Na stronie
          <a
            href="https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/ogloszenia/szukaj"
            target="_none"
            >Krajowego Planu Odbudowy</a
          >
          udostępniono mapę przedstawiającą przedsiębiorstwa z branży HoReCa
          (hotelarska i gastronomiczna), które otrzymają dotacje ze środków
          unijnych. Pieniądze trafią m.in. na zakup jachtów, saun, ekspresów do
          kawy czy rowerów elektrycznych.
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card class="ma-1 pa-3" height="100%">
          <v-card-title class="pa-0 ma-2" align="center">
            <div class="text-h5 font-weight-bold text-primary">Pomóżmy premierowi wybrać!</div>
          </v-card-title>
          Tam, gdzie ten wydatek był nieuzasadniony merytorycznie, Donald Tusk
          oczekuje odebrania środków.
          <br>
          <strong
            >Jednak, który z tych projektów jest najbardziej...
            "XD"</strong
          >
          <br>
          Zagłosuj pod najbardziej odklejonymi zgłoszeniami poniżej
        </v-card>
      </v-col>
    </v-row>

    <v-alert
      v-if="!user || !user?.uid"
      text="Zaloguj się, by móc zagłosować"
      color="warning"
      closable
      @click.stop="() => router.push('/login')"
    />

    <KPOCarousel />
  </div>
</template>

<script setup lang="ts">
import { useAuthState } from "@/composables/auth";
const { user } = useAuthState();
const router = useRouter();

definePageMeta({
  title: "Ranking KPO",
});
</script>
