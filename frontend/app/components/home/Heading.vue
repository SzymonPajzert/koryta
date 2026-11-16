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

    <!-- Centred as a block too, not only its lines: at 75% of the column a
         centred heading's subtitle otherwise hangs off its left edge. Its
         lines are balanced, so the last is not one or two words alone. -->
    <div
      v-if="subtitle"
      class="text-body-2 text-medium-emphasis mb-4 w-100 w-md-75"
      :class="{ 'mx-auto heading__subtitle--center': center }"
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

<style scoped>
.heading__subtitle--center {
  text-wrap: balance;
}
</style>
