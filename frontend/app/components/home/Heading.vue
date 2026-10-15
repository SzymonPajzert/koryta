<template>
  <div height="100%" :class="{ 'text-center': center }">
    <!-- h2: these head sections of the home page („Mapa koryciarstwa”, „Co
         nowego”), under the page's one h1, and are set as section heads. -->
    <NuxtLink
      v-if="to"
      :to="to"
      class="text-decoration-none text-high-emphasis"
    >
      <h2 class="k-section-title mb-2">
        {{ title }}
      </h2>
    </NuxtLink>
    <h2 v-else class="k-section-title mb-2">
      {{ title }}
    </h2>

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
