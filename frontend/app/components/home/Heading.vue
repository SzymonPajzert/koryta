<template>
  <div height="100%">
    <h1 class="text-title-1 font-weight-bold mb-2">
      {{ title }}
    </h1>

    <div class="text-body-2 text-medium-emphasis mb-4 w-100 w-md-75">
      {{ subtitle }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>
