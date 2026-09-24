<template>
  <div class="afact">
    <div class="afact__label">{{ label }}</div>
    <div class="afact__value"><slot /></div>
  </div>
</template>

<script setup lang="ts">
/** One fact about an open row - "Autor", "Kiedy", "Status" - for the `meta`
 * slot of `AdminExpandRow`. Styled there, by variant. */
defineProps<{ label: string }>();
</script>
