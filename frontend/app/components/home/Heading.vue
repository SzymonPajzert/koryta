<template>
  <div height="100%" :class="{ 'text-center': center }">
    <NuxtLink
      v-if="to"
      :to="to"
      class="text-decoration-none text-high-emphasis"
    >
      <h1 class="text-title-1 font-weight-bold mb-2">
        {{ title }}
      </h1>
    </NuxtLink>
    <h1 v-else class="text-title-1 font-weight-bold mb-2">
      {{ title }}
    </h1>

    <div
      v-if="subtitle"
      class="text-body-2 text-medium-emphasis mb-4 w-100 w-md-75"
    >
      {{ subtitle }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
  center?: boolean;
  to?: string;
}>();
</script>
