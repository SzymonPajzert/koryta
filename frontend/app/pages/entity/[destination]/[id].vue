<template>
  <EntityDetailView :key="id" :node="id" :type="destination" />
</template>

<script setup lang="ts">
import { authFetch } from "@/composables/auth";
import type { Node, NodeType } from "~~/shared/model";
import { generateEntityUrl } from "~/composables/slugs";
import EntityDetailView from "~/components/EntityDetailView.vue";

const route = useRoute<"/entity/[destination]/[id]">();
const destination = route.params.destination as NodeType;
const id = route.params.id as string;

// Attempt to fetch node to redirect to SEO URL
const { data, status } = await authFetch<{ node: Node }>(`/api/nodes/${id}`);

if (status.value === "success" && data.value?.node?.name) {
  const newUrl = generateEntityUrl(destination, id, data.value.node.name);
  if (route.path !== newUrl) {
    if (import.meta.server) {
      await navigateTo(newUrl, { redirectCode: 301 });
    } else {
      await navigateTo(newUrl, { replace: true });
    }
  }
}
</script>
