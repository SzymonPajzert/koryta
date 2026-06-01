<template>
  <v-container
    class="pa-3 pa-md-6"
    fluid
    :style="{ background: color ? '#a8c79f' : 'transparent' }"
  >
    <v-responsive class="mx-auto pa-1" max-width="1200">
      <slot />
    </v-responsive>
  </v-container>
</template>

<script setup lang="ts">
const { color } = defineProps<{ color?: boolean }>();
</script>
