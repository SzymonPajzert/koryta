<template>
  <!-- Layout for the fun part of the site (/gry). For now it only wraps the
       gray layout; over time it will get its own identity (branding, nav to
       other games, streaks). Pages using it must set fullWidth: true, same as
       with the gray layout. -->
  <GrayLayout>
    <slot />
  </GrayLayout>
</template>

<script lang="ts" setup>
import GrayLayout from "./gray.vue";
</script>
