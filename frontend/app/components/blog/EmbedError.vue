<template>
  <v-alert
    type="warning"
    variant="tonal"
    density="compact"
    class="my-6"
    data-testid="blog-embed-error"
  >
    Nie udało się pokazać elementu „{{ name }}”.
    <!-- The problems are for whoever is writing the post, which happens in a
         local build; tests/content/blogPosts.test.ts keeps a post with any of
         them from getting further. -->
    <ul v-if="isLocal" class="mt-2 ml-4 text-body-2">
      <li v-for="error in errors" :key="error">{{ error }}</li>
    </ul>
  </v-alert>
</template>

<script setup lang="ts">
defineProps<{ name: string; errors: string[] }>();

const isLocal = useRuntimeConfig().public.isLocal;
</script>
