<template>
  <div class="arow-list">
    <slot />
  </div>
</template>

<script setup lang="ts">
/** The frame around a run of `AdminExpandRow`s: one border, rows ruled off
 * inside it, the way the ordering mode on /admin/opinie draws its queue. */
</script>

<style>
.arow-list {
  border: 1px solid var(--k-line);
  border-radius: var(--k-r-card);
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
</style>
