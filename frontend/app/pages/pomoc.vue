<template>
  <v-row>
    <v-col cols="12">
      <h2>Dołącz do społeczności</h2>
    </v-col>
    <v-col cols="12">
      <!-- TODO update the link before the end of January 2025 -->
      <nuxt-link
        to="https://join.slack.com/t/korytapl/shared_invite/zt-3mx37782c-X2tRnWIYdMkSJm5oqK6yqQ"
        tag="div"
        class="clickable-card"
      >
        <HomeCard height="100px"
          ><template #header>Dołącz do Slacka</template>
          Pracują z nami ludzie od UX, programowania, analizy danych i
          czegokolwiek co może się przydać.
        </HomeCard>
      </nuxt-link>
    </v-col>
    <v-col cols="12" md="6">
      <nuxt-link
        to="https://docs.google.com/forms/d/e/1FAIpQLSfZX4ekzLEhX60f6Frn3JMKkYwbqG2tE1NNNN0Eu_Ozr814FQ/viewform"
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
          resztą użytkowników nad kolejnymi użytecznościami na
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
