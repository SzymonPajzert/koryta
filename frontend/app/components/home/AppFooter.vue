<template>
  <v-footer
    class="pt-6 pt-md-16 pb-0 d-flex flex-column"
    :style="{ background: '#a8c79f' }"
    border
  >
    <v-row max-width="1000" justify="center">
      <v-col cols="12" lg="6" md="12">
        <div class="d-flex align-columns">
          <NuxtImg
            class="mt-1 mb-6"
            width="120"
            src="/logo_small.png"
            style="object-fit: contain"
            alt="Koryta.pl"
            loading="lazy"
          />

          <p class="ml-4">
            Koryta.pl to projekt społeczny i open-source budujący bazę powiązań
            w przestrzeni publicznej.
          </p>
        </div>

        <div class="mt-3">
          <v-btn
            v-for="[icon, link] in icons"
            :key="icon"
            :icon="icon"
            size="small"
            variant="text"
            :href="link"
            target="_blank"
          />
        </div>
      </v-col>

      <v-col v-for="(section, i) in sections" :key="i" cols="6" md="4" lg="2">
        <p class="text-body-1 font-weight-bold mb-3">{{ section.title }}</p>

        <div v-for="item in section.items" :key="item.title">
          <v-btn
            class="text-none px-0 justify-start"
            exact
            :to="'link' in item ? item.link : undefined"
            :href="'href' in item ? item.href : undefined"
            :target="'href' in item ? '_blank' : undefined"
            :ripple="false"
            :text="item.title"
            variant="plain"
          />
        </div>
      </v-col>
    </v-row>

    <p class="py-4 text-caption text-right w-100">
      &copy; {{ new Date().getFullYear() }} Koryta.pl. Wszelkie prawa
      zastrzeżone.
    </p>
  </v-footer>
</template>

<script lang="ts" setup>
import { mdiFacebook, mdiGithub, mdiInstagram, mdiTwitter } from "@mdi/js";
const sections = [
  {
    title: "O projekcie",
    items: [
      { title: "O nas", link: "/o-nas" },
      { title: "Źródła", link: "/zrodla" },
    ],
  },
  {
    title: "Informacje prawne",
    items: [
      { title: "Regulamin", link: "/plik/regulamin" },
      { title: "Polityka prywatności", link: "/plik/polityka_prywatnosci" },
    ],
  },
  {
    title: "Wesprzyj nas",
    items: [
      { title: "Patronite", href: "https://patronite.pl/romb.me" },
      { title: "Zrzutka", href: "https://zrzutka.pl/rd7ssx/pay" },
      { title: "Zostań wolontariuszem", link: "/pomoc" },
    ],
  },
];

const icons = [
  [mdiGithub, "https://github.com/SzymonPajzert/koryta"],
  [mdiTwitter, "https://twitter.com/korytapl"],
  [mdiFacebook, "https://www.facebook.com/people/Korytapl/61581508966044/"],
  [mdiFacebook, "https://www.facebook.com/groups/korytapl"],
  [mdiInstagram, "https://www.instagram.com/szymon.pajzert"],
];
</script>
