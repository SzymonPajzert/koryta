<template>
  <v-app-bar>
    <v-app-bar-nav-icon />
    <v-toolbar-title to="/">koryta.pl</v-toolbar-title>
    <v-spacer />
    <v-btn text to="/">Start</v-btn>
    <v-btn text to="/list">Lista</v-btn>
    <v-btn text to="/add">Dodaj</v-btn>
    <v-btn text v-if="user">Profil</v-btn>
    <v-btn text v-if="!user" to="/login">Zaloguj się</v-btn>
    <v-btn text v-if="user" @click="logout">Wyloguj</v-btn>
  </v-app-bar>
  <v-main>
    <v-container class="fill-height" max-width="900">
      <router-view />
    </v-container>
  </v-main>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue';
import { app } from '@/stores/firebase'
import { getAnalytics, logEvent } from 'firebase/analytics';
import { useAuthState } from '@/composables/auth';
const { user, logout } = useAuthState();

onMounted(() => {
  const analytics = getAnalytics(app);

  logEvent(analytics, 'page_view', {
    page_location: window.location.href,
    page_path: window.location.pathname,
    page_title: document.title,
    user_agent: navigator.userAgent,
  });
});
</script>
