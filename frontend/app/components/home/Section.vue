<template>
  <!-- The page's sections stand one section gap apart, 40px and 32 on a
       phone, as an entity page's do (`k-sections`, assets/css/edges.css). The
       gap is a margin between two sections (below), not padding of their own:
       each used to pad itself 24px above and below with the column's 4 inside
       that, which stood two of them 56 apart on a computer.

       The band is the exception. Its colour is the section, so its padding
       stays inside it, as before, and the next section stands one gap below
       its edge.

       `end` for the page's last section: its content stands one section gap
       above the footer, as every other page's last block does
       (`k-page-end`). -->
  <v-container
    class="home-section px-3 px-md-6"
    :class="[color ? 'py-3 py-md-6' : 'py-0', { 'k-page-end': end }]"
    fluid
    :style="{ background: color ? 'rgb(var(--v-theme-band))' : 'transparent' }"
  >
    <v-responsive
      class="mx-auto px-1"
      :class="{ 'py-1': color }"
      max-width="1200"
    >
      <slot />
    </v-responsive>
  </v-container>
</template>

<script setup lang="ts">
const { color, end } = defineProps<{ color?: boolean; end?: boolean }>();
</script>

<style scoped>
.home-section + .home-section {
  margin-top: var(--k-section-gap);
}
</style>
