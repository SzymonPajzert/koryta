<script setup lang="ts"></script>

<template>
  <GraphCanvas :filtered="filtered" />
</template>

<script setup lang="ts">
const { filtered } = useParams("Graf ");

definePageMeta({
  title: "Graf",
  isGraph: true,
  fullWidth: true,
});
</script>
