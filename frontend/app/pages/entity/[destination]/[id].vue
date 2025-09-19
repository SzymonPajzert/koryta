<template>
  <EmployedDetail
    v-if="type === 'employed'"
    :node="id"
    :close="() => {}"
    width="100%"
  />
</template>

<script setup lang="ts">
const route = useRoute<"/entity/[destination]/[id]">();

const id = route.params.id as string;
const type = route.params.destination;
</script>
