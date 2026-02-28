<template>
  <GraphContainer :filtered="filtered" />
</template>

<script setup lang="ts">
import { useParams } from "~/composables/params";

const { filtered } = useParams("Graf ");

definePageMeta({
  title: "Graf",
  isGraph: true,
  fullWidth: true,
});
</script>
