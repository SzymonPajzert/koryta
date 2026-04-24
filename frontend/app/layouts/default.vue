<template>
  <v-app-bar>
    <NuxtImg
      class="mx-2"
      src="/logo_small.png"
      width="40"
      height="40"
      fetchpriority="high"
      preload
      style="cursor: pointer; object-fit: contain"
      alt="Koryta.pl"
      @click="$router.push('/')"
    />
    <v-app-bar-title
      v-if="mdAndUp"
      style="cursor: pointer"
      @click="$router.push('/')"
    >
      koryta.pl
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
      <v-avatar
        v-if="user && pictureURL"
        :image="pictureURL"
        size="32"
        @click="router.push('/profil')"
      />
      <v-btn v-if="user && !pictureURL" icon to="/profil">
        <v-icon>mdi-account</v-icon>
      </v-btn>
      <v-btn v-if="!user" :icon="!mdAndUp" to="/login">
        <v-icon v-if="!mdAndUp">mdi-account</v-icon>
        <span class="d-none d-md-inline">Zaloguj się</span>
      </v-btn>
      <v-btn v-if="user && mdAndUp" text @click="logout">Wyloguj</v-btn>
    </template>
  </v-app-bar>
  <v-main class="d-flex flex-column">
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
        prepend-icon="mdi-comment-text-multiple-outline"
        variant="text"
        to="/leads"
      >
        Leady
      </v-btn>
      <v-btn
        prepend-icon="mdi-magnify-scan"
        variant="text"
        :to="{ path: '/admin/audit', query: { tab: 'pending' } }"
      >
        Audyt
      </v-btn>
      <v-btn
        prepend-icon="mdi-lightning-bolt"
        variant="text"
        href="https://github.com/users/SzymonPajzert/projects/2/views/3"
        target="_blank"
      >
        Nowy bug w GitHubie
      </v-btn>
      <v-btn
        v-if="affineLink"
        prepend-icon="mdi-lightning-bolt"
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
import { computed } from "vue";
import { useAuthState } from "@/composables/auth";
import { useDisplay } from "vuetify";

const { mdAndUp } = useDisplay();
const { user, userConfig, logout } = useAuthState();
const router = useRouter();
const route = useRoute();
const maxWidth = computed(() =>
  route?.meta?.fullWidth ? "none" : (route?.meta?.maxWidth ?? 1200),
);
const rootPadding = computed(() => (route?.meta?.fullWidth ? 0 : undefined));
const affineLink = computed(() => route?.meta?.affineLink);
const pictureURL = computed(() => userConfig?.data?.value?.photoURL);
</script>
