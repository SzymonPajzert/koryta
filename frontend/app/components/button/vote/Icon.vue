<template>
  <v-avatar
    :icon="icon"
    :color="color"
    rounded
    size="36"
    :variant="highlight ? 'flat' : 'tonal'"
  >
    <v-icon size="24" />
  </v-avatar>
</template>

<script setup lang="ts">
const { icon, color, highlight } = defineProps<{
  icon: string;
  color: string;
  highlight: boolean;
}>();
</script>
