<template>
  <MultiDialog />
  <v-app-bar>
    <v-img
      class="mx-2"
      src="@/assets/logo_small.png"
      max-height="40"
      max-width="40"
      contain
    />
    <v-app-bar-title v-if="mdAndUp" style="cursor: pointer" @click="$router.push('/')"
      >koryta.pl</v-app-bar-title
    >
    <v-spacer />
    <omni-search />
    <v-spacer />

    <template #append>
      <v-btn icon :to="{ path: '/lista', query: route.query }"
        ><v-icon>mdi-format-list-bulleted-type</v-icon></v-btn
      >
      <v-btn icon :to="{ path: '/graf', query: pick(route.query, 'miejsce') }"
        ><v-icon>mdi-graph-outline</v-icon></v-btn
      >
      <v-btn :icon="!mdAndUp" to="/pomoc">
        <v-icon :start="mdAndUp">mdi-plus</v-icon>
        <!-- This span will be hidden on 'sm' and smaller screens -->
        <span class="d-none d-md-inline">Działaj</span>
      </v-btn>
      <v-btn v-if="mdAndUp" text to="/zrodla">Źródła</v-btn>
      <v-avatar v-if="user && pictureURL" :image="pictureURL" size="32" @click="router.push('/profil')"/>
      <v-btn v-if="user && !pictureURL" icon to="/profil">
        <v-icon>mdi-account</v-icon>
      </v-btn>
      <v-btn v-if="!user" icon to="/login">
        <v-icon>mdi-account</v-icon>
      </v-btn>
      <v-btn v-if="user && mdAndUp" text @click="logout">Wyloguj</v-btn>
    </template>
  </v-app-bar>
  <v-main>
    <v-container
      class="fill-height"
      :max-width="maxWidth"
      :style="{ padding: rootPadding }"
    >
      <NuxtPage />
    </v-container>
  </v-main>
</template>

<script lang="ts" setup>
import { onMounted, computed } from "vue";
import { getAnalytics, logEvent } from "firebase/analytics";
import { useAuthState } from "@/composables/auth";
import MultiDialog from "~/components/dialog/MultiDialog.vue";
import { useDisplay } from 'vuetify'

if (import.meta.client) {
  onMounted(() => {
    const analytics = getAnalytics();

    logEvent(analytics, "page_view", {
      page_location: window.location.href,
      page_path: window.location.pathname,
      page_title: document.title,
      user_agent: navigator.userAgent,
    });
  });
}

const { mdAndUp } = useDisplay()
const { user, userConfig, logout } = useAuthState();
const router = useRouter();
const route = useRoute();
const maxWidth = computed(() => (route.meta.fullWidth ? "none" : 900));
const rootPadding = computed(() => (route.meta.fullWidth ? 0 : undefined));
const pictureURL = computed(() => userConfig.data.value?.photoURL)

function pick<T>(obj: Record<string, T>, ...keys: string[]) {
  const result: Record<string, T> = {};
  for (const key of keys) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

</script>
