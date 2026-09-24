<template>
  <div class="arow-list" :class="`arow-list--${variant}`">
    <slot />
  </div>
</template>

<script setup lang="ts">
/** The frame around a run of `AdminExpandRow`s: one border, rows ruled off
 * inside it, the way the ordering mode on /admin/opinie draws its queue. */
import { useRowVariant } from "~/composables/rowVariant";

const variant = useRowVariant();
</script>

<style>
.arow-list {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}

.arow-list--b,
.arow-list--c {
  border-radius: 10px;
  border-color: rgba(var(--v-border-color), 0.16);
}
</style>
