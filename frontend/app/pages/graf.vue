<template>
  <GraphContainer :filtered="filtered" focus-node-id="0" />
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
