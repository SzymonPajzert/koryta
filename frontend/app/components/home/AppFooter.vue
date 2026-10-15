<template>
  <!-- The sage band, its colour untouched, set in type rather than in
       buttons. Home keeps a band of its own, half the height it was: the
       wordmark and a sentence beside the project's links, the legal links
       and the socials under a rule. Every other page gets one slim row on the
       same band: on a person's page the 400px footer was the biggest thing
       after the person.

       The links are text in the band's full ink (11.33:1 on sage), not
       `variant="plain"` buttons: a plain button drew them at .62 opacity with
       the uppercase tracking, 3.86:1. -->
  <v-footer
    class="app-footer pa-0"
    :class="isHome ? 'app-footer--band' : 'app-footer--slim'"
    :style="{ background: 'rgb(var(--v-theme-band))' }"
  >
    <div v-if="isHome" class="app-footer__inner">
      <div class="app-footer__top">
        <div>
          <NuxtLink to="/" class="app-footer__wordmark">koryta.pl</NuxtLink>
          <p class="app-footer__about">
            Projekt społeczny i open-source budujący bazę powiązań
            w&nbsp;przestrzeni publicznej.
          </p>
        </div>
        <nav class="app-footer__links" aria-label="O projekcie">
          <NuxtLink
            v-for="item in projectLinks"
            :key="item.link"
            :to="item.link"
          >
            {{ item.title }}
          </NuxtLink>
        </nav>
      </div>
      <div class="app-footer__base">
        <span>&copy; {{ year }} Koryta.pl</span>
        <nav class="app-footer__legal" aria-label="Informacje prawne">
          <NuxtLink v-for="item in legalLinks" :key="item.link" :to="item.link">
            {{ item.title }}
          </NuxtLink>
        </nav>
        <span class="app-footer__social">
          <v-btn
            v-for="social in socials"
            :key="social.link"
            :icon="social.icon"
            :href="social.link"
            :aria-label="social.label"
            :title="social.label"
            target="_blank"
            size="small"
            variant="text"
          />
        </span>
      </div>
    </div>

    <div v-else class="app-footer__row">
      <NuxtLink to="/" class="app-footer__brand">
        <!-- Not lazy: a 24px image saves nothing by waiting for the footer
             to come into view. -->
        <NuxtImg src="/logo_small.png" width="24" height="24" alt="" />
        <span>koryta.pl</span>
        <small class="app-footer__copy">&copy; {{ year }}</small>
      </NuxtLink>
      <nav class="app-footer__links" aria-label="O projekcie">
        <NuxtLink v-for="item in projectLinks" :key="item.link" :to="item.link">
          {{ item.title }}
        </NuxtLink>
      </nav>
      <nav class="app-footer__legal" aria-label="Informacje prawne">
        <small class="app-footer__copy">&copy; {{ year }}</small>
        <NuxtLink v-for="item in legalLinks" :key="item.link" :to="item.link">
          {{ item.title }}
        </NuxtLink>
      </nav>
      <span class="app-footer__social">
        <v-btn
          v-for="social in socials"
          :key="social.link"
          :icon="social.icon"
          :href="social.link"
          :aria-label="social.label"
          :title="social.label"
          target="_blank"
          size="small"
          variant="text"
        />
      </span>
    </div>
  </v-footer>
</template>

<script lang="ts" setup>
import { mdiFacebook, mdiGithub, mdiInstagram, mdiTwitter } from "@mdi/js";

const route = useRoute();
const isHome = computed(() => route.path === "/");
const year = new Date().getFullYear();

const projectLinks = [
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
];

const legalLinks = [
  { title: "Regulamin", link: "/plik/regulamin" },
  { title: "Polityka prywatności", link: "/plik/polityka_prywatnosci" },
];

const socials = [
  {
    icon: mdiGithub,
    link: "https://github.com/SzymonPajzert/koryta",
    label: "GitHub",
  },
  { icon: mdiTwitter, link: "https://twitter.com/korytapl", label: "X" },
  {
    icon: mdiFacebook,
    link: "https://www.facebook.com/people/Korytapl/61581508966044/",
    label: "Facebook",
  },
  {
    icon: mdiFacebook,
    link: "https://www.facebook.com/groups/korytapl",
    label: "Grupa na Facebooku",
  },
  {
    icon: mdiInstagram,
    link: "https://www.instagram.com/szymon.pajzert",
    label: "Instagram",
  },
];
</script>

<style scoped>
.app-footer {
  color: rgb(var(--v-theme-ink-strong));
  display: block;
}

.app-footer a {
  color: inherit;
  text-decoration: none;
}

.app-footer a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.app-footer__social {
  display: flex;
  margin-inline: auto -8px;
}

/* ---- home: the band, compact ---- */

.app-footer__inner {
  margin: 0 auto;
  max-width: 1192px;
}

.app-footer__top {
  align-items: end;
  display: grid;
  gap: 16px 48px;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  padding: 40px 0 24px;
}

/* The whole name in bold, as in the app bar. */
.app-footer__wordmark {
  display: inline-block;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
}

.app-footer__wordmark:hover {
  text-decoration: none !important;
}

.app-footer__about {
  font-size: 0.875rem;
  line-height: 1.45;
  margin: 10px 0 0;
  max-width: 44ch;
}

.app-footer--band .app-footer__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0 24px;
  justify-content: flex-end;
}

.app-footer--band .app-footer__links a {
  font-size: 1rem;
  font-weight: 500;
  line-height: 36px;
}

/* A rule in translucent black: it darkens the sage rather than adding a
   colour to it. */
.app-footer__base {
  align-items: center;
  border-top: 1px solid rgba(0, 0, 0, 0.16);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.875rem;
  gap: 0 20px;
  line-height: 36px;
  padding: 6px 0 10px;
}

.app-footer--band .app-footer__legal {
  display: flex;
  flex-wrap: wrap;
  gap: 0 20px;
}

/* ---- every other page: one slim row ---- */

/* The page's column: 1200 with the 16px gutter, so the brand lines up with
   the page's left edge above it. */
.app-footer__row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  font-size: 0.875rem;
  gap: 4px 24px;
  line-height: 20px;
  margin: 0 auto;
  max-width: 1200px;
  padding: 14px 16px;
}

.app-footer__brand {
  align-items: center;
  display: flex;
  font-weight: 700;
  gap: 8px;
  letter-spacing: -0.01em;
}

.app-footer__copy {
  font-size: 0.75rem;
  font-weight: 400;
  letter-spacing: 0;
}

.app-footer--slim .app-footer__links,
.app-footer--slim .app-footer__legal {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0 18px;
}

.app-footer--slim .app-footer__legal .app-footer__copy {
  display: none;
}

@media (min-width: 1280px) {
  .app-footer--slim .app-footer__legal {
    border-left: 1px solid rgba(0, 0, 0, 0.16);
    padding-inline-start: 24px;
  }
}

/* 960-1279: two deliberate rows - the brand and the project's links, then
   the legal links and the socials. */
@media (min-width: 960px) and (max-width: 1279.98px) {
  .app-footer__row {
    row-gap: 2px;
  }

  .app-footer--slim .app-footer__links {
    flex: 1 1 calc(100% - 220px);
  }

  .app-footer--slim .app-footer__legal {
    padding-inline-start: 32px;
  }
}

/* Phones: the brand and the socials, the project's links, then the legal
   line - 14px text in 36px rows, a comfortable tap. */
@media (max-width: 959.98px) {
  .app-footer__inner {
    padding: 0 16px;
  }

  .app-footer__top {
    gap: 8px;
    grid-template-columns: 1fr;
    padding: 28px 0 12px;
  }

  .app-footer--band .app-footer__links {
    gap: 0 20px;
    justify-content: flex-start;
  }

  .app-footer__base {
    padding: 4px 0 12px;
  }

  .app-footer--band .app-footer__social {
    flex-basis: 100%;
    margin: 0 0 0 -8px;
    order: -1;
  }

  .app-footer__row {
    gap: 0 16px;
    padding: 12px 16px 16px;
  }

  .app-footer__brand {
    min-height: 44px;
  }

  .app-footer__brand .app-footer__copy {
    display: none;
  }

  .app-footer--slim .app-footer__social {
    order: 1;
  }

  .app-footer--slim .app-footer__links {
    flex-basis: 100%;
    margin-top: 4px;
    order: 2;
  }

  .app-footer--slim .app-footer__legal {
    flex-basis: 100%;
    order: 3;
  }

  .app-footer--slim .app-footer__legal .app-footer__copy {
    display: inline;
    font-size: 0.875rem;
  }

  .app-footer--slim .app-footer__links a,
  .app-footer--slim .app-footer__legal a,
  .app-footer--slim .app-footer__legal .app-footer__copy {
    line-height: 36px;
  }
}

@media (min-width: 960px) and (max-width: 1223.98px) {
  .app-footer__inner {
    padding: 0 16px;
  }
}
</style>
