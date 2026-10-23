<template>
  <ContentRenderer
    :value="post"
    :components="blogEmbedComponents"
    class="blog-body"
  />
</template>

<script setup lang="ts">
import type { BlogPost } from "~~/shared/blog";
import { blogEmbedComponents } from "~/utils/blogEmbeds";

/** A post's text, with its embeds drawn by the components in
 * utils/blogEmbeds.ts. */
defineProps<{ post: BlogPost }>();
</script>

<style scoped>
/* Everything below is markdown rendered by MDC, outside this component's
   scope, hence :deep. Sized for reading: the column is ~70 characters wide and
   the body a little over the app's default, since this page is mostly text. */
.blog-body {
  font-size: 1.0625rem;
  line-height: 1.7;
  overflow-wrap: break-word;
}

.blog-body :deep(p),
.blog-body :deep(ul),
.blog-body :deep(ol),
.blog-body :deep(blockquote),
.blog-body > :deep(table) {
  margin-bottom: 1.25rem;
}

.blog-body :deep(h2) {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 2.5rem 0 1rem;
}

.blog-body :deep(h3) {
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.35;
  margin: 2rem 0 0.75rem;
}

/* MDC wraps a heading's text in a link to its own anchor, so a section can be
   linked to; it reads as the heading, not as a link. */
.blog-body :deep(:is(h2, h3, h4) a) {
  color: inherit;
  text-decoration: none;
}

.blog-body :deep(a) {
  color: rgb(var(--v-theme-ink-info));
  text-underline-offset: 2px;
}

.blog-body :deep(ul),
.blog-body :deep(ol) {
  padding-left: 1.5rem;
}

.blog-body :deep(li) {
  margin-bottom: 0.375rem;
}

.blog-body :deep(blockquote) {
  padding-left: 1rem;
  border-left: 4px solid rgb(var(--v-theme-ink-sage));
  color: rgb(var(--v-theme-ink-neutral));
}

.blog-body :deep(code) {
  padding: 0.1em 0.3em;
  border-radius: 4px;
  font-size: 0.9em;
  background: rgb(var(--v-theme-surface-muted));
}

/* A wide table scrolls inside the column instead of widening the page. A
   table written in markdown only, a direct child of the body: the one inside a
   chart's table view is Vuetify's, and block display would undo its layout. */
.blog-body > :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.95rem;
}

.blog-body > :deep(table :is(th, td)) {
  padding: 6px 12px;
  border-bottom: 1px solid var(--k-line);
  text-align: left;
}

.blog-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
}

.blog-body :deep(hr) {
  margin: 2rem 0;
  border: none;
  border-top: 1px solid var(--k-line);
}

.blog-body :deep(sup a) {
  text-decoration: none;
}

.blog-body :deep(.footnotes) {
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid var(--k-line);
  font-size: 0.9375rem;
}

.blog-body :deep(.footnotes h2) {
  font-size: 1rem;
  margin: 0 0 0.75rem;
}
</style>
