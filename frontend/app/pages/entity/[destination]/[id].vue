<template>
  <EmployedDetail :node="id" :close="() => {}" v-if="type === 'employed'" />
</template>

<script setup lang="ts">
const route = useRoute<"/entity/[destination]/[id]">();

const id = route.params.id;
const type = route.params.destination;
</script>
