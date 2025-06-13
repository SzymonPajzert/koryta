<template>
  <v-app-bar>
    <v-app-bar-nav-icon></v-app-bar-nav-icon>
    <v-toolbar-title>koryta.pl</v-toolbar-title>
    <v-spacer></v-spacer>
    <v-btn text to="/">Start</v-btn>
    <v-btn text to="/list">Lista</v-btn>
    <v-btn text to="/login">Zaloguj się</v-btn>
  </v-app-bar>
  <v-main>
    <v-container class="fill-height" max-width="900">
      <router-view />
    </v-container>
  </v-main>
</template>

<script lang="ts" setup>
</script>
