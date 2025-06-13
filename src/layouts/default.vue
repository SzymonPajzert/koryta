<template>
  <header>
    <nav>
      <ul>
        <li><router-link to="/">Strona początkowa</router-link></li>
        <li><router-link to="/list">Lista</router-link></li>
        <li><router-link to="/login">Zaloguj się</router-link></li>
      </ul>
    </nav>
  </header>
  <v-main>
    <v-container class="fill-height" max-width="900">
      <router-view />
    </v-container>
  </v-main>
</template>

<script lang="ts" setup>
</script>
