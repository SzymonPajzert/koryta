<template>
  <DialogMulti />
  <v-app-bar>
    <v-img
      class="mx-2"
      src="@/assets/logo_small.png"
      max-height="40"
      max-width="40"
      contain
      style="cursor: pointer"
      @click="$router.push('/')"
    />
    <v-app-bar-title
      v-if="mdAndUp"
      style="cursor: pointer"
      @click="$router.push('/')"
      >koryta.pl</v-app-bar-title
    >
    <v-spacer />
    <omni-search />
    <v-spacer />

    <template #append>
      <v-btn icon :to="{ path: '/lista', query: safeQuery }"
        ><v-icon>mdi-format-list-bulleted-type</v-icon></v-btn
      >
      <v-btn icon :to="{ path: '/graf', query: { miejsce: safeQuery.miejsce } }"
        ><v-icon>mdi-graph-outline</v-icon></v-btn
      >
      <v-btn :icon="!mdAndUp" to="/pomoc">
        <v-icon :start="mdAndUp">mdi-plus</v-icon>
        <!-- This span will be hidden on 'sm' and smaller screens -->
        <span class="d-none d-md-inline">Działaj</span>
      </v-btn>
      <v-btn v-if="mdAndUp" text to="/zrodla">Źródła</v-btn>
      <v-avatar
        v-if="user && pictureURL"
        :image="pictureURL"
        size="32"
        @click="router.push('/profil')"
      />
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
    <v-toolbar v-if="user" density="compact" color="primary">
      <v-spacer />
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" prepend-icon="mdi-plus" variant="text">
            Dodaj nowe
          </v-btn>
        </template>
        <v-list>
          <v-list-item
            prepend-icon="mdi-plus"
            :to="{ path: '/edit/node/new', query: { type: 'article' } }"
            :active="
              route.path === '/edit/node/new' && route.query.type === 'article'
            "
            title="Dodaj artykuł"
          />
          <v-list-item
            prepend-icon="mdi-plus"
            :to="{ path: '/edit/node/new', query: { type: 'person' } }"
            :active="
              route.path === '/edit/node/new' && route.query.type === 'person'
            "
            title="Dodaj osobę"
          />
          <v-list-item
            prepend-icon="mdi-plus"
            :to="{ path: '/edit/node/new', query: { type: 'place' } }"
            :active="
              route.path === '/edit/node/new' && route.query.type === 'place'
            "
            title="Dodaj firmę"
          />
        </v-list>
      </v-menu>
      <v-btn
        prepend-icon="mdi-format-list-bulleted"
        variant="text"
        to="/revisions"
      >
        Lista rewizji
      </v-btn>
      <v-btn
        prepend-icon="mdi-comment-text-multiple-outline"
        variant="text"
        to="/leads"
      >
        Leady
      </v-btn>
      <v-btn prepend-icon="mdi-magnify-scan" variant="text" to="/admin/audit">
        Audyt
      </v-btn>
      <v-btn
        prepend-icon="mdi-lightning-bolt"
        variant="text"
        href="https://github.com/SzymonPajzert/koryta/issues/new"
        target="_blank"
      >
        Zgłoś problem
      </v-btn>
      <v-spacer icon />
    </v-toolbar>
    <v-container
      class="fill-height position-relative"
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
import { useDisplay } from "vuetify";

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

const { mdAndUp } = useDisplay();
const { user, userConfig, logout } = useAuthState();
const router = useRouter();
const route = useRoute();
const safeQuery = computed(() => route?.query || {});
const maxWidth = computed(() => (route?.meta?.fullWidth ? "none" : 900));
const rootPadding = computed(() => (route?.meta?.fullWidth ? 0 : undefined));
const pictureURL = computed(() => userConfig?.data?.value?.photoURL);
</script>
