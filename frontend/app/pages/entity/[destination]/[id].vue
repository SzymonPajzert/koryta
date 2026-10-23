<template>
  <!-- A company opened by id gets the page its readable url gets
       ([seoType]/[slug].vue). A published one never renders here - the
       middleware sends it on to /instytucja/ - but a draft does, and that is
       how an admin reaches one: the graph's double click, the links on
       /admin/rewizje. It used to get EntityDetailView's old place card, with
       none of the company page's sections. PlaceDetailView reads the node
       with the reader's token and again once they sign in, and lays a
       `?revisionId` over it, as EntityDetailView does, and the middleware
       leaves a draft's query alone.

       An article stays on EntityDetailView. ArticleDetailView has no
       `?revisionId` preview, which the revision queue links a draft article
       to, and it does not fetch the node again once the reader's sign-in
       resolves, so a full load of a draft would greet an admin with „Nie
       udało się wczytać artykułu”. -->
  <PlaceDetailView v-if="destination === 'place'" :key="id" :node-id="id" />
  <EntityDetailView v-else :key="id" :node="id" :type="destination" />
</template>

<script setup lang="ts">
import type { NodeType } from "~~/shared/model";
import EntityDetailView from "~/components/EntityDetailView.vue";

definePageMeta({
  // Redirects to the readable url; see app/middleware/entity-slug.ts.
  middleware: "entity-slug",
});

const route = useRoute<"/entity/[destination]/[id]">();
const destination = route.params.destination as NodeType;
const id = route.params.id as string;
</script>
