<template>
  <!-- `end` for the page's last section: its content stands one section gap
       above the footer, as every other page's last block does
       (`k-page-end`, assets/css/edges.css), rather than this band's 24px,
       12 on a phone, plus the column's 4. -->
  <v-container
    class="pa-3 pa-md-6"
    :class="{ 'k-page-end': end }"
    fluid
    :style="{ background: color ? 'rgb(var(--v-theme-band))' : 'transparent' }"
  >
    <v-responsive
      class="mx-auto pa-1"
      :class="{ 'pb-0': end }"
      max-width="1200"
    >
      <slot />
    </v-responsive>
  </v-container>
</template>

<script setup lang="ts">
const { color, end } = defineProps<{ color?: boolean; end?: boolean }>();
</script>
