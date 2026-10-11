<template>
  <BlogEmbedError v-if="!embed.success" name="stats" :errors="embed.errors" />
  <v-sheet
    v-else
    border
    rounded="lg"
    class="blog-stats my-6 pa-4"
    data-testid="blog-stats"
  >
    <StatsStatTile
      v-for="item in embed.data.items"
      :key="item.label"
      :label="item.label"
      :value="item.value"
      :unit="item.unit"
      :hint="item.hint"
      :tooltip="item.tooltip"
    />
  </v-sheet>
</template>

<script setup lang="ts">
/** `::stats` - a row of headline numbers. One number does not need a chart. */
defineOptions({ inheritAttrs: false });

const embed = useBlogEmbed("stats");
</script>

<style scoped>
.blog-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px 24px;
}
</style>
