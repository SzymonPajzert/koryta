<template>
  <RouterView />
</template>

<script lang="ts" setup>
definePageMeta({
  title: "Admin",
  middleware: "admin",
});
</script>
