<template>
  <ListView :people="people"/>
</template>

<script lang="ts" setup>
  import { useListEntity } from '@/composables/entity'
  const { entities: people } = useListEntity("employed");
</script>
