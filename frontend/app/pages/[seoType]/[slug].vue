<template>
  <EntityDetailView :key="id" :node="id" :type="type" />
</template>

<script setup lang="ts">
import {
  parseEntityUrlSlug,
  slugPrefixToNodeType,
  generateNodeUrl,
  seoTypes,
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
  if (route.path !== expectedUrl) {
    if (import.meta.server) {
      await navigateTo(expectedUrl, { redirectCode: 301 });
    } else {
      await navigateTo(expectedUrl, { replace: true });
    }
  }
}

// Update head with the node name for basic SEO before Nuxt kicks in (optional as EntityDetailView does it too)
useHead({
  title: computed(() => data.value?.node?.name || "Strona"),
});
</script>
