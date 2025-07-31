<template>
  <multi-dialog />
  <v-app-bar>
    <v-img
      class="mx-2"
      src="@/assets/świnia2.png"
      max-height="40"
      max-width="40"
      contain
    ></v-img>
    <v-app-bar-title style="cursor: pointer" @click="$router.push('/')"
      >koryta.pl</v-app-bar-title
    >
    <v-spacer />
    <v-btn text to="/">Start</v-btn>
    <v-btn text to="lista">Lista</v-btn>
    <v-btn text to="/graf">Graf</v-btn>
    <v-btn text to="/pomoc">Działaj</v-btn>
    <v-btn text to="/zrodla">Źródła</v-btn>
    <v-btn icon v-if="user" to="/profil">
      <v-icon>mdi-account</v-icon>
    </v-btn>
    <v-btn text v-if="!user" to="/login">Zaloguj się</v-btn>
    <v-btn text v-if="user" @click="logout">Wyloguj</v-btn>
  </v-app-bar>
  <v-main>
    <v-container
      class="fill-height"
      :max-width="maxWidth"
      :style="{ padding: rootPadding }"
    >
      <router-view />
    </v-container>
  </v-main>
</template>

<script lang="ts" setup>
import { onMounted, computed } from "vue";
import { app } from "@/firebase";
import { getAnalytics, logEvent } from "firebase/analytics";
import { useAuthState } from "@/composables/auth";
import { useRoute } from "vue-router";

const { user, logout } = useAuthState();

onMounted(() => {
  const analytics = getAnalytics(app);

  logEvent(analytics, "page_view", {
    page_location: window.location.href,
    page_path: window.location.pathname,
    page_title: document.title,
    user_agent: navigator.userAgent,
  });
});

const route = useRoute();
const maxWidth = computed(() => (route.meta.isGraph ? "none" : 900));
const rootPadding = computed(() => (route.meta.isGraph ? 0 : undefined));
</script>
