<template>
  <ListView :people="people.entities" />
</template>

<script lang="ts" setup>
import { useParams } from "@/composables/params";

const { filterName, queryParams } = useParams();
useHead({
  title: `Lista ${filterName.value}`,
});

const { data: people } = await useFetch("/api/nodes/person", {
  query: queryParams,
});
</script>
