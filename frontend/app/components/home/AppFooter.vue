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

      <v-col v-for="(section, i) in sections" :key="i" cols="6" md="3">
        <p class="text-body-1 font-weight-bold mb-3">{{ section.title }}</p>

        <div v-for="item in section.items" :key="item.title">
          <v-btn
            class="text-none px-0 justify-start"
            exact
            :to="item.link"
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
      { title: "Tematy", link: "/tematy" },
      { title: "Rady szpitali", link: "/eksploruj/szpitale" },
      { title: "Okrągły staż", link: "/eksploruj/staz" },
      { title: "Źródła", link: "/zrodla" },
      // EventFeed bounds the home feed so a reader can reach "the footer,
      // which is where the contact address and the source links live", and
      // the qa entry for it says the same - but there was no way to the
      // address from here, so somebody hunting for „kontakt" scrolled to the
      // bottom and found nothing.
      { title: "Kontakt", link: "/o-nas#kontakt" },
      // The app bar only carries this above 960px and the home page only
      // above 960px, so on a phone the footer is the whole of how somebody
      // finds their way to helping.
      { title: "Działaj z nami", link: "/pomoc" },
    ],
  },
  {
    title: "Informacje prawne",
    items: [
      { title: "Regulamin", link: "/plik/regulamin" },
      { title: "Polityka prywatności", link: "/plik/polityka_prywatnosci" },
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
