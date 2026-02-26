<template>
  {{ user?.displayName }} to Ty {{ user?.email }} to Twój email
  <v-btn text @click="logout">Wyloguj</v-btn>
</template>

<script lang="ts" setup>
const { user, logout } = useAuthState();
</script>
