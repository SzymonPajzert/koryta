<template>
  <div class="blog-column py-4 py-sm-8">
    <h1 class="text-h4 font-weight-bold mb-2">Blog</h1>
    <p class="k-page-lead mb-8">
      Analizy zespołu Koryta.pl: co wynika z danych o osobach i instytucjach,
      które opisujemy.
    </p>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      text="Nie udało się pobrać wpisów. Spróbuj odświeżyć stronę."
    />

    <div v-else-if="posts.length" class="d-flex flex-column ga-4">
      <v-card
        v-for="post in posts"
        :key="post.slug"
        :to="post.path"
        variant="outlined"
        rounded="lg"
        :data-testid="`blog-post-${post.slug}`"
      >
        <v-card-item>
          <BlogPostMeta :post="post" class="mb-1" />
          <h2 class="text-h6 text-wrap blog-index__title">
            {{ post.title }}
          </h2>
        </v-card-item>
        <v-card-text class="text-body-1 pt-0">
          {{ post.description }}
        </v-card-text>
      </v-card>
    </div>

    <p v-else class="text-body-1 text-medium-emphasis">
      Pierwsze wpisy już wkrótce.
    </p>
  </div>
</template>

<script setup lang="ts">
import type { BlogPostSummary } from "~~/shared/blog";
import { SOCIAL_CARD } from "~/composables/entitySeo";

const { data, error } = await useFetch<BlogPostSummary[]>("/api/blog", {
  key: "blog-posts",
});
const posts = computed(() => data.value ?? []);

const description =
  "Analizy zespołu Koryta.pl: co wynika z danych o osobach i instytucjach, które opisujemy.";
useSeoMeta({
  title: "Blog - Koryta.pl",
  description,
  ogTitle: "Blog - Koryta.pl",
  ogDescription: description,
  ogImage: SOCIAL_CARD,
  twitterCard: "summary_large_image",
  twitterImage: SOCIAL_CARD,
});
// Nothing to rank for until there is a post on it.
useRobotsRule(
  computed(() => (posts.value.length ? "index, follow" : "noindex, follow")),
);
</script>

<style scoped>
.blog-column {
  max-width: 760px;
  margin-inline: auto;
  width: 100%;
}

.blog-index__title {
  line-height: 1.35;
}
</style>
