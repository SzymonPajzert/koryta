<template>
  <article v-if="post" class="blog-column pb-4 pb-sm-8">
    <NuxtLink to="/blog" class="text-body-2 blog-post__back"> ← Blog </NuxtLink>

    <h1 class="text-h4 font-weight-bold mt-4 mb-2 blog-post__title">
      {{ post.title }}
    </h1>
    <BlogPostMeta :post="post" class="mb-6" />
    <p class="text-h6 font-weight-regular mb-8 blog-post__lead">
      {{ post.description }}
    </p>

    <!-- Keyed by the post: its embeds read their attributes once, so another
         post is a new body rather than this one handed new attributes. -->
    <BlogBody :key="post.slug" :post="post" />
  </article>
</template>

<script setup lang="ts">
import type { BlogPost } from "~~/shared/blog";
import { SOCIAL_CARD } from "~/composables/entitySeo";

const route = useRoute();
const slug = computed(() => String(route.params.slug));

// Keyed by the slug, for the reason pages/plik/[name].vue gives: a key derived
// from the call site is shared by every post, and under Suspense the outgoing
// page still holds it when the incoming one runs - so the next post would
// open with the last one's text.
const { data: post, error } = await useAsyncData(
  () => `blog:${slug.value}`,
  () => $fetch<BlogPost>(`/api/blog/${slug.value}`),
);

if (error.value || !post.value) {
  throw createError({
    statusCode: error.value?.statusCode ?? 404,
    statusMessage: "Nie ma takiego wpisu",
    fatal: true,
  });
}

const siteUrl = useRuntimeConfig().public.siteUrl;
const image = computed<string>(() => post.value?.image ?? SOCIAL_CARD);

useSeoMeta({
  title: () => `${post.value?.title} - Koryta.pl`,
  description: () => post.value?.description,
  ogTitle: () => post.value?.title,
  ogDescription: () => post.value?.description,
  ogType: "article",
  ogImage: image,
  twitterCard: "summary_large_image",
  twitterImage: image,
  articlePublishedTime: () => post.value?.date,
  articleAuthor: () => post.value?.authors,
});
useSchemaOrg([
  defineArticle(
    computed(() => ({
      headline: post.value?.title,
      description: post.value?.description,
      datePublished: post.value?.date,
      image: `${siteUrl}${image.value}`,
      author: (post.value?.authors ?? []).map((name) => ({ name })),
    })),
  ),
]);
// A draft is only ever served by a local build, but a page saying "szkic"
// should not be indexed even there.
useRobotsRule(
  computed(() => (post.value?.draft ? "noindex, nofollow" : "index, follow")),
);
</script>

<style scoped>
.blog-column {
  max-width: 760px;
  margin-inline: auto;
  width: 100%;
}

.blog-post__back {
  color: rgb(var(--v-theme-ink-neutral));
  text-decoration: none;
}

.blog-post__back:hover {
  text-decoration: underline;
}

.blog-post__title {
  line-height: 1.25;
}

.blog-post__lead {
  line-height: 1.5;
  color: rgb(var(--v-theme-ink-neutral));
}
</style>
