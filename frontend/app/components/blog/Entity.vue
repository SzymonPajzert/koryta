<template>
  <NuxtLink v-if="url" :to="url" data-testid="blog-entity"
    ><slot>{{ name }}</slot></NuxtLink
  ><span v-else data-testid="blog-entity"
    ><slot>{{ name }}</slot></span
  >
</template>

<script setup lang="ts">
import type { Node } from "~~/shared/model";
import { generateNodeUrl } from "~~/shared/slugs";

/** `:entity[Jan Kowalski]{id="…"}` - the words in brackets, linked to that
 * page on the site.
 *
 * The link is built from the page as it is now rather than written into the
 * post, so it follows a renamed person to their new url, and a page that has
 * been merged into another to the one that survived. A page nobody may read -
 * unpublished, removed - leaves the words as plain text: the post still reads,
 * and does not send anybody to a 404. */
defineOptions({ inheritAttrs: false });

const embed = useBlogEmbed("entity");
const id = embed.success ? embed.data.id : "";

// Public reads only, deliberately not `authFetch`: a signed-in author must see
// the post as a reader will, links to their own unpublished drafts included.
const { data } = await useFetch<{ node: Node }>(
  `/api/nodes/${encodeURIComponent(id)}`,
  { key: `blog-entity:${id}`, immediate: id !== "" },
);

const node = computed(() => data.value?.node);
const url = computed(() =>
  node.value
    ? generateNodeUrl({ ...node.value, id: node.value.id ?? id })
    : undefined,
);
const name = computed(() => node.value?.name ?? id);
</script>
