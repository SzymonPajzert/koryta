<template>
  <div>{{ props.start }} - {{ end }}</div>
</template>

<script lang="ts" setup>
const props = defineProps<{
  start: string | undefined;
  end: string | undefined;
  minStart: string | undefined;
  maxEnd: string | undefined;
}>();
</script>
