<template>
  <NuxtLink
    :to="target"
    class="rev-permalink arow-link"
    title="Link do tej propozycji"
    :data-testid="`permalink-${revisionId}`"
  >
    <slot />
  </NuxtLink>
</template>

<script setup lang="ts">
/** A proposal's own address, on its date - the way a report's date is its
 * link on /admin/opinie and a note's is on /admin/notatki.
 *
 * It opens the review queue with this one proposal pinned on top, open and
 * marked, whatever the filters say and after it has been decided, so a link
 * pasted in chat opens the same thing tomorrow. Followed, it leaves the
 * address in the url bar; right-clicked, it copies like any link. It was a
 * copy button among the approve and reject buttons, until those were made the
 * only buttons there - see `RevisionReviewActions`.
 *
 * The default is for /admin/rewizje, which is where it is drawn - the queue's
 * rows and the histories inside the entry rows. The page's own filters and
 * paging stay in the url beside it, as "Rozpatrz" on a relation change keeps
 * them: the endpoint pins the proposal whatever they say, and a reviewer who
 * clicked a date should not find the queue switched back to its defaults under
 * it. Anywhere else, pass `to`.
 */
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";

const props = defineProps<{
  revisionId: string;
  /** Somewhere else to point, where the queue is not the proposal's best
   * home - the entry page's own history links a revision to itself. */
  to?: RouteLocationRaw;
}>();

const route = useRoute();

const target = computed<RouteLocationRaw>(
  () =>
    props.to ?? {
      path: "/admin/rewizje",
      query: { ...route.query, rewizja: props.revisionId },
      hash: "#kolejka",
    },
);
</script>

<style scoped>
/* Keeps the colour of the fact it sits in and says it is a link by its
 * underline, like the report dates on /admin/opinie. */
.rev-permalink {
  color: inherit;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
</style>
