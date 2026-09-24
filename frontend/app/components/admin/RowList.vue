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
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
</style>
