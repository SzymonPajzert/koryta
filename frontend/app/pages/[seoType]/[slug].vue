<template>
  <!-- An article has a page of its own. `EntityDetailView` could not serve it:
       every section it renders for an article reads the local graph, which
       drops any edge with an article on either end. -->
  <ArticleDetailView v-if="type === 'article'" :key="id" :node-id="id" />
  <!-- A company gets its own view for the same reason an article does: every
       section it wants - the register entry, who sits there now, who they took
       over from - is about a place, and none of them means anything on a
       person's page. -->
  <PlaceDetailView v-else-if="type === 'place'" :key="id" :node-id="id" />
  <EntityDetailView v-else :key="id" :node="id" :type="type" />
</template>

<script setup lang="ts">
import {
  parseEntityUrlSlug,
  slugPrefixToNodeType,
  generateNodeUrl,
  mayBeMangledId,
  seoTypes,
  SLUG_REDIRECT_CODE,
  type SeoType,
} from "~/composables/slugs";
import type { NodeType, Node } from "~~/shared/model";
import { authFetch } from "@/composables/auth";

definePageMeta({
  validate: (route) => {
    return seoTypes.includes(route.params.seoType as SeoType);
  },
});

const route = useRoute();
const { id } = parseEntityUrlSlug(route.params.slug as string);
const type = slugPrefixToNodeType(route.params.seoType as SeoType) as NodeType;

// Self-healing check
const { data, status } = await authFetch<{ node: Node }>(`/api/nodes/${id}`);

if (status.value === "success" && data.value?.node?.name) {
  const expectedUrl = generateNodeUrl(data.value.node);
  // A node type with no canonical url of its own stays where it is. Without the
  // guard the undefined fell through to navigateTo and redirected the visitor to
  // the site root, which is where every article link in the sitemap used to land.
  if (expectedUrl && route.path !== expectedUrl) {
    if (import.meta.server) {
      await navigateTo(expectedUrl, { redirectCode: SLUG_REDIRECT_CODE });
    } else {
      await navigateTo(expectedUrl, { replace: true });
    }
  }
} else if (status.value === "error" && import.meta.server) {
  // An id that has lost its capitals, or kept the full stop of the sentence it
  // was pasted into, still names a page - see `mangledIdKey` for where those
  // links come from. Googlebot asked for 51 such addresses 241 times between
  // 2026-09-16 and 10-01, nearly always citing as the referrer the very page
  // they should have led to, and got a 404 every time.
  //
  // 301, unlike SLUG_REDIRECT_CODE: a mangled id never becomes a page of its
  // own, and the address it is sent on to heals itself if the page's slug moves
  // later - so a browser that keeps this answer for good keeps a right one.
  const found = mayBeMangledId(id)
    ? await $fetch<{ url: string }>(
        `/api/nodes/${encodeURIComponent(id)}/url`,
      ).catch(() => undefined)
    : undefined;
  if (found && found.url !== route.path) {
    await navigateTo(found.url, { redirectCode: 301 });
  } else {
    // Say 404 in the status line, not only in the heading.
    //
    // `/api/nodes/:id` throws 404 both for an id that resolves to nothing and
    // for a page nobody has published, and the detail views render "Strona
    // nieznaleziona" for either - but the response went out as 200, carrying a
    // canonical pointing at itself. That is a soft 404: Google files the url as
    // a real page and keeps recrawling it.
    //
    // Server only. On the client the navigation has already happened and there
    // is no status line left to set; the view says the same thing either way.
    setResponseStatus(useRequestEvent()!, 404);
  }
}

// The head is EntityDetailView's - it is the one that knows whether the node
// loaded, and it sets the description and the social card alongside the title.
</script>
