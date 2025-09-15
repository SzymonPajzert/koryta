<template>
  <EmployedDetail v-if="type === 'employed'" :node="id" :close="() => {}" />
</template>

<script setup lang="ts">
const route = useRoute<"/entity/[destination]/[id]">();

const id = route.params.id;
const type = route.params.destination;
</script>
