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
</style>
