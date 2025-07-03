<template>
  <ListView :people="people" />
</template>

<script lang="ts" setup>
import ListView from "@/components/ListView.vue";
import { useListEmployment } from "@/composables/party";

const { people } = useListEmployment();
</script>
