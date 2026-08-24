<template>
  <v-app>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </v-app>
</template>

<style scoped></style>

<style>
html {
  scroll-behavior: smooth;
}

/* Vuetify tints disabled filled buttons by laying a dark overlay over the
   button colour, which turns our sage primary into an unreadable olive.
   Use a neutral grey container + label instead. */
.v-btn--disabled.v-btn--variant-elevated,
.v-btn--disabled.v-btn--variant-flat {
  background: rgba(var(--v-theme-on-surface), 0.12) !important;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}

.v-btn--disabled.v-btn--variant-elevated .v-btn__overlay,
.v-btn--disabled.v-btn--variant-flat .v-btn__overlay {
  opacity: 0;
}

/* A link that is the row rather than a call to action - an entry name in a
   list, where every row carries one and the browser default turns the whole
   column blue. Reads as body text, underlines only when it is actually being
   pointed at, so the affordance survives without the colour.

   Global because the profile card and the review queue render the same
   proposal and must not drift apart; `.zrodla-link` and `.contributors__link`
   are older, scoped copies of these exact rules. */
.link-plain,
.link-plain:visited {
  color: inherit;
  text-decoration: none;
}

.link-plain:hover,
.link-plain:focus-visible {
  text-decoration: underline;
}
</style>
