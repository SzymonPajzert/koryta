<template>
  <p class="text-body-2 text-medium-emphasis">
    <time :datetime="post.date">{{ longDate(post.date) }}</time>
    · {{ post.authors.join(", ") }} · {{ post.readingMinutes }} min czytania
    <v-chip v-if="post.draft" size="x-small" variant="tonal" class="ml-1">
      szkic
    </v-chip>
  </p>
</template>

<script setup lang="ts">
import type { BlogPostSummary } from "~~/shared/blog";
import { longDate } from "~~/shared/dates";

/** The line over a post: when, who, how long. A draft says so - it is only
 * ever seen in a local build. */
defineProps<{ post: BlogPostSummary }>();
</script>
