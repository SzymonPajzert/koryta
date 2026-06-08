<template>
  <GraphContainer :filtered="filtered" />
</template>

<script setup lang="ts">
const filtered = {};

definePageMeta({
  title: "Graf",
  isGraph: true,
  fullWidth: true,
  robots: false,
});
</script>
