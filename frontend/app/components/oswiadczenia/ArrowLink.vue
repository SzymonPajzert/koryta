<template>
  <NuxtLink :to="to" class="alink">
    <slot />
    <v-icon v-if="arrow" :icon="mdiArrowRight" size="16" />
  </NuxtLink>
</template>

<script setup lang="ts">
import { mdiArrowRight } from "@mdi/js";

/** A way on from the declarations' numbers: underlined in dots like the
 * links of the admin overview's chain, solid under the pointer, 44 px tall to
 * the thumb. */
withDefaults(defineProps<{ to: string; arrow?: boolean }>(), { arrow: true });
</script>

<style scoped>
.alink {
  align-items: center;
  color: rgb(var(--v-theme-ink-strong));
  display: inline-flex;
  font-size: 0.9375rem;
  font-weight: 500;
  gap: 4px;
  min-height: 44px;
  text-decoration: underline dotted;
  text-underline-offset: 4px;
}

.alink:hover {
  text-decoration-style: solid;
}

.alink:focus-visible {
  border-radius: 2px;
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
}
</style>
