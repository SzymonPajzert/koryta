<template>
  <v-row>
    <v-col cols="12" sm="4"><HomeCard>Dodaj artykuł</HomeCard> </v-col>
    <v-col cols="12" sm="4"><HomeCard>Dodaj spółkę (KRS)</HomeCard> </v-col>
    <v-col cols="12" sm="4"><HomeCard>Wyślij informację</HomeCard> </v-col>
    <v-col cols="12" md="6"><HomeCard>Przejrzyj osoby</HomeCard></v-col>
    <v-col cols="12" md="6"><HomeCard>Wyślij informację</HomeCard></v-col>

    <v-col cols="12">
      <h2>Dołącz do społeczności</h2>
    </v-col>
    <v-col cols="12" md="6">
      <nuxt-link
        to="https://www.guidedtrack.com/programs/9fk0fj2/run"
        tag="div"
        class="clickable-card"
      >
        <HomeCard height="100px"
          ><template #header>Wypełnij formularz zgłoszeniowy</template>
          A my odpiszemy Ci z podprojektami, w których możesz wziąć udział.
        </HomeCard>
      </nuxt-link>
    </v-col>
    <v-col cols="12" md="6">
      <nuxt-link to="https://forum.koryta.pl" tag="div" class="clickable-card">
        <HomeCard height="100px"
          ><template #header>Dołącz do forum.koryta.pl</template> I dyskutuj z
          resztą użytkowników nad kolejnymi użytczenościami na
          stronie.</HomeCard
        >
      </nuxt-link>
    </v-col>

    <v-col cols="12" md="6" align="center">
      <iframe
        src="https://discord.com/widget?id=1338546021319315468&theme=dark"
        width="400"
        height="300"
        allowtransparency="true"
        frameborder="0"
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
      />
    </v-col>
    <v-col cols="12" md="6" align="center">
      <iframe
        src="https://widgets.sociablekit.com/facebook-group-posts/iframe/25619702"
        frameborder="0"
        width="400px"
        height="300px"
      />
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
import { HomeCard } from "#components";

definePageMeta({
  title: "Działaj z nami",
  isHelp: true,
  middleware: "auth",
});
</script>

<style scoped>
.clickable-card {
  cursor: pointer;
  text-decoration: none;
}
</style>
