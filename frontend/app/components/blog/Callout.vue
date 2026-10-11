<template>
  <aside class="blog-callout my-6" data-testid="blog-callout">
    <div v-if="embed.success && embed.data.title" class="blog-callout__title">
      {{ embed.data.title }}
    </div>
    <slot />
  </aside>
</template>

<script setup lang="ts">
/** `::callout` - an aside boxed off from the argument: how something was
 * counted, what the numbers cannot say. */
defineOptions({ inheritAttrs: false });

const embed = useBlogEmbed("callout");
</script>

<style scoped>
.blog-callout {
  padding: 16px 20px;
  border-radius: 8px;
  border-left: 4px solid rgb(var(--v-theme-ink-sage));
  background: rgb(var(--v-theme-surface-sage));
}

.blog-callout__title {
  font-weight: 600;
  margin-bottom: 8px;
}

/* The slot is the post's own markdown, rendered outside this scope. */
.blog-callout > :deep(:last-child) {
  margin-bottom: 0;
}
</style>
