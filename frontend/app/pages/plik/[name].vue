<script setup lang="ts">
const route = useRoute();
const name = route.params.name as string;
const { data: file } = await useAsyncData(() =>
  queryCollection("content")
    .path("/" + name)
    .first(),
);

useSeoMeta({
  title: file.value?.title,
  description: file.value?.description,
});
</script>

<template>
  <ContentRenderer v-if="file" :value="file" />
  <div v-else>Nie znaleziono strony</div>
</template>
