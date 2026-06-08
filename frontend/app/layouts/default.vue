<template>
  <v-app-bar>
    <NuxtLink to="/">
      <NuxtImg
        class="mx-2"
        src="/logo_small.png"
        width="40"
        height="40"
        fetchpriority="high"
        preload
        style="cursor: pointer; object-fit: contain"
        alt="Koryta.pl"
      />
    </NuxtLink>

    <v-app-bar-title v-if="mdAndUp">
      <NuxtLink
        to="/"
        class="text-decoration-none"
        style="color: inherit; cursor: pointer"
      >
        koryta.pl
      </NuxtLink>
    </v-app-bar-title>
    <v-spacer />
    <omni-search v-if="!route?.meta.hideSearch" />
    <v-spacer />

    <template #append>
      <v-btn v-if="mdAndUp" text to="/o-nas">O nas</v-btn>
      <v-btn v-if="mdAndUp" text to="/pomoc">Wesprzyj</v-btn>
      <v-btn
        v-if="mdAndUp"
        text
        href="https://docs.google.com/forms/d/e/1FAIpQLSfZX4ekzLEhX60f6Frn3JMKkYwbqG2tE1NNNN0Eu_Ozr814FQ/viewform"
        target="_blank"
        >Dołącz</v-btn
      >
      <v-btn v-if="user && pictureURL" icon to="/profil" size="32">
        <v-avatar :image="pictureURL" size="32" />
      </v-btn>
      <v-btn v-if="user && !pictureURL" icon to="/profil">
        <v-icon :icon="mdiAccount" />
      </v-btn>
      <v-btn v-if="!user" :icon="!mdAndUp" to="/login">
        <v-icon v-if="!mdAndUp" :icon="mdiAccount" />
        <span class="d-none d-md-inline">Zaloguj się</span>
      </v-btn>
      <v-btn v-if="user && mdAndUp" text @click="logout">Wyloguj</v-btn>
    </template>
  </v-app-bar>
  <v-main class="d-flex flex-column">
    <v-toolbar v-if="user" density="compact" color="primary">
      <v-spacer />

      <v-btn
        :prepend-icon="mdiLightningBolt"
        variant="text"
        href="https://github.com/users/SzymonPajzert/projects/2/views/3"
        target="_blank"
      >
        Nowy bug w GitHubie
      </v-btn>
      <v-btn
        v-if="affineLink"
        :prepend-icon="mdiLightningBolt"
        variant="text"
        :href="`https://app.affine.pro/workspace/794db959-e4b7-4756-8db2-61cf824329fa/${affineLink}?mode=edgeless`"
        target="_blank"
      >
        Dyskusja w affine
      </v-btn>
      <v-spacer icon />
    </v-toolbar>
    <v-container
      class="position-relative fill-height"
      :max-width="maxWidth"
      :style="{ padding: rootPadding }"
    >
      <NuxtPage />
    </v-container>
    <HomeAppFooter class="mt-auto w-100" />
  </v-main>
</template>

<script lang="ts" setup>
import { mdiAccount, mdiLightningBolt } from "@mdi/js";
import { computed } from "vue";
import { useAuthState } from "@/composables/auth";
import { useDisplay } from "vuetify";

const { mdAndUp } = useDisplay();
const { user, userConfig, logout } = useAuthState();
const route = useRoute();
const maxWidth = computed(() =>
  route?.meta?.fullWidth ? "none" : (route?.meta?.maxWidth ?? 1200),
);
const rootPadding = computed(() => (route?.meta?.fullWidth ? 0 : undefined));
const affineLink = computed(() => route?.meta?.affineLink);
const pictureURL = computed(() => userConfig?.data?.value?.photoURL);
</script>
