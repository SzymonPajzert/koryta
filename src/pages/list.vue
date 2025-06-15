<template>
  <ListView :people/>
</template>

<script lang="ts" setup>
  import { useListEmployment } from '@/composables/party'
  const { people } = useListEmployment()
  import ListView from '@/components/ListView.vue'
</script>
