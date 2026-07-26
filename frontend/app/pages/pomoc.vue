<template>
  <v-row>
    <!-- Intro -->
    <v-col cols="12">
      <h1 class="text-h4 font-weight-bold mb-2">Działaj z nami</h1>
      <p class="text-body-1 text-medium-emphasis mb-1">
        Koryta.pl to projekt społeczny — rośnie dzięki ludziom takim jak Ty.
        Wystarczy pięć minut, by sprawdzić kilka osób w bazie, a jeśli chcesz
        więcej: dołącz do zespołu albo wesprzyj nas finansowo.
      </p>
      <v-btn
        variant="text"
        color="primary"
        to="/o-nas"
        :append-icon="mdiChevronRight"
        class="ms-n4"
      >
        Dowiedz się więcej o projekcie
      </v-btn>
    </v-col>

    <!-- Quick actions -->
    <v-col cols="12" class="mt-4">
      <h2 class="text-h6">Pomóż nam znaleźć nowe osoby</h2>
      <p class="text-body-2 text-medium-emphasis">
        Nie potrzebujesz konta ani doświadczenia — możesz zacząć od razu.
      </p>
    </v-col>
    <v-col v-for="action in quickActions" :key="action.title" cols="12" md="6">
      <v-card
        :to="action.to"
        :href="action.href"
        :target="action.href ? '_blank' : undefined"
        height="100%"
        variant="outlined"
        hover
      >
        <v-card-item>
          <template #prepend>
            <v-icon :icon="action.icon" size="large" color="primary" />
          </template>
          <v-card-title>{{ action.title }}</v-card-title>
        </v-card-item>
        <v-card-text class="text-medium-emphasis">
          {{ action.desc }}
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Support the project -->
    <v-col cols="12" class="mt-8">
      <h2 class="text-h6">Wesprzyj projekt na dłużej</h2>
    </v-col>
    <v-col cols="12" md="4">
      <v-card
        href="https://docs.google.com/forms/d/e/1FAIpQLSfZX4ekzLEhX60f6Frn3JMKkYwbqG2tE1NNNN0Eu_Ozr814FQ/viewform"
        target="_blank"
        height="100%"
        variant="outlined"
        hover
      >
        <v-card-item>
          <template #prepend>
            <v-icon
              :icon="mdiAccountPlusOutline"
              size="large"
              color="primary"
            />
          </template>
          <v-card-title>Zostań wolontariuszem</v-card-title>
        </v-card-item>
        <v-card-text class="text-medium-emphasis">
          Wypełnij krótki formularz, a odezwiemy się z podprojektami
          dopasowanymi do Twoich umiejętności. Pracują z nami ludzie od UX,
          programowania, analizy danych i czegokolwiek, co może się przydać.
        </v-card-text>
      </v-card>
    </v-col>
    <v-col cols="12" md="4">
      <v-card
        href="https://patronite.pl/romb.me"
        target="_blank"
        height="100%"
        variant="outlined"
        hover
      >
        <v-card-item>
          <template #prepend>
            <v-icon :icon="mdiHeartOutline" size="large" color="primary" />
          </template>
          <v-card-title>Wesprzyj na Patronite</v-card-title>
        </v-card-item>
        <v-card-text class="text-medium-emphasis">
          Nie mamy sponsorów ani partyjnego wsparcia. Regularne wpłaty pozwalają
          nam utrzymać stronę i rozwijać automatyzację.
        </v-card-text>
      </v-card>
    </v-col>
    <v-col cols="12" md="4">
      <v-card height="100%" variant="outlined" hover @click="openNewsletter">
        <v-card-item>
          <template #prepend>
            <v-icon :icon="mdiEmailOutline" size="large" color="primary" />
          </template>
          <v-card-title>Zapisz się do newslettera</v-card-title>
        </v-card-item>
        <v-card-text class="text-medium-emphasis">
          Załóż konto i wybierz, o czym chcesz dostawać wiadomości — nowych
          osobach w bazie i okazjach do działania.
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Community -->
    <v-col cols="12" class="mt-8">
      <h2 class="text-h6">Dołącz do społeczności</h2>
      <p class="text-body-2 text-medium-emphasis">
        Poznaj ludzi, którzy tworzą projekt na co dzień.
      </p>
    </v-col>
    <v-col v-for="link in communityLinks" :key="link.title" cols="12" md="4">
      <v-card
        :href="link.href"
        target="_blank"
        height="100%"
        variant="outlined"
        hover
      >
        <v-card-item>
          <template #prepend>
            <v-icon :icon="link.icon" size="large" color="primary" />
          </template>
          <v-card-title>{{ link.title }}</v-card-title>
        </v-card-item>
        <v-card-text class="text-medium-emphasis">
          {{ link.desc }}
        </v-card-text>
      </v-card>
    </v-col>

    <DialogLogin
      v-model="loginDialog"
      hide-activator
      @success="navigateTo('/profil')"
    />
  </v-row>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import {
  mdiAccountPlusOutline,
  mdiChevronRight,
  mdiEmailOutline,
  mdiFacebook,
  mdiGithub,
  mdiHeartOutline,
  mdiLayersSearchOutline,
  mdiSlack,
  mdiTextBoxSearchOutline,
} from "@mdi/js";
import { useAuthState } from "@/composables/auth";
import { useStats } from "~/composables/stats/useStats";

// Discord brand icon from simple-icons; @mdi/js no longer ships brand icons.
const discordIcon =
  "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z";

definePageMeta({
  title: "Działaj z nami",
  isHelp: true,
  layout: "gray",
  fullWidth: true,
});

useSeoMeta({
  title: "Działaj z nami - Koryta.pl",
  description:
    "Pomóż nam znaleźć nowe przykłady koryciarstwa: przeglądaj nowe osoby, kategoryzuj fakty, wesprzyj projekt lub dołącz jako wolontariusz.",
});

const { toCheck } = useStats();

const quickActions = [
  {
    title: "Przeglądaj nowe osoby",
    to: "/eksploruj/nowe",
    icon: mdiLayersSearchOutline,
    desc: `Oceń osoby, które nie są jeszcze opublikowane na stronie. Do sprawdzenia zostało jeszcze ${toCheck}.`,
  },
  {
    title: "Kategoryzuj fakty",
    to: "/ekstrakcje/kategoryzacja",
    icon: mdiTextBoxSearchOutline,
    desc: "Oceniaj fakty automatycznie wyciągnięte ze źródeł — jedno kliknięcie na fakt.",
  },
  {
    title: "Zgłoś błąd lub pomysł",
    href: "https://github.com/SzymonPajzert/koryta/issues/new",
    icon: mdiGithub,
    desc: "Masz pomysł na usprawnienie lub znalazłeś błąd? Zgłoś go na GitHubie.",
  },
];

// TODO update the link before the end of January 2025
const communityLinks = [
  {
    title: "Slack",
    href: "https://join.slack.com/t/korytapl/shared_invite/zt-3mx37782c-X2tRnWIYdMkSJm5oqK6yqQ",
    icon: mdiSlack,
    desc: "Tam koordynujemy bieżącą pracę nad projektem.",
  },
  {
    title: "Discord",
    href: "https://discord.com/invite/QvU5syTZ",
    icon: discordIcon,
    desc: "Dyskutuj z resztą użytkowników nad kolejnymi użytecznościami na stronie.",
  },
  {
    title: "Grupa na Facebooku",
    href: "https://www.facebook.com/groups/korytapl",
    icon: mdiFacebook,
    desc: "Śledź nowości i dziel się znaleziskami z innymi obserwującymi.",
  },
];

const { user } = useAuthState();
const loginDialog = ref(false);

const openNewsletter = () => {
  if (user.value) {
    navigateTo("/profil");
  } else {
    loginDialog.value = true;
  }
};
</script>
