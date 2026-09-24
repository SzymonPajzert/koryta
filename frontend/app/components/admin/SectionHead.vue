<template>
  <div class="asec">
    <h2 class="asec__title">{{ title }}</h2>
    <span v-if="count !== undefined" class="asec__count" data-section-count>
      {{ count }}
    </span>
    <InfoBubble v-if="info" :label="title">{{ info }}</InfoBubble>
    <div v-if="$slots.default" class="asec__actions">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/** The heading over one section of an admin list: its name, how many entries
 * it holds, what it is for in a bubble, and room at the end for the section's
 * own controls (filters, "Pokaż zamknięte"). */
defineProps<{
  title: string;
  count?: number | string;
  /** What the section is for; goes in the „(i)” bubble. */
  info?: string;
}>();
</script>

<style>
.asec {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 20px 0 10px;
}

.asec__title {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: -0.01em;
}

.asec__count {
  min-width: 24px;
  padding: 0 8px;
  border-radius: 99px;
  text-align: center;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.5rem;
  background: rgb(var(--v-theme-ink-strong));
  color: #fff;
}

.asec__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-inline-start: auto;
}
</style>
