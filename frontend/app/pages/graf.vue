<template>
  <GraphContainer :filtered="filtered" />
</template>

<script setup lang="ts">
import { useParams } from "~/composables/params";

const { filters } = useParams();
const { entities: filtered } = useEntity("person", filters);

definePageMeta({
  title: "Graf",
  isGraph: true,
  fullWidth: true,
});
</script>
