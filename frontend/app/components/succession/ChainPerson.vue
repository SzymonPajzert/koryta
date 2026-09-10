<template>
  <div
    class="k-card k-card--accent person"
    :data-testid="isFocus ? 'chain-focus' : undefined"
  >
    <div class="person__head">
      <NuxtLink
        v-if="node.personName"
        :to="personUrl"
        class="link-plain person__name"
      >
        {{ node.personName }}
      </NuxtLink>
      <!-- A settled node with no name is the endpoint saying "not for you, or
           not a person". It is all but unreachable here - a candidate is only
           offered when the reader may be told about them, so the person was
           nameable one request ago - and it is drawn as a dash rather than as
           an error, because nothing failed. The page draws the same state at
           the focus, where it IS the whole answer, as „nie znaleźliśmy takiej
           osoby”. -->
      <!-- Only once the node has settled. A node still in flight has no name
           yet either, and drawing the dash for it would spend the same glyph
           on two different facts - "we may not name this person" and "we have
           not asked yet" - one under a spinner. -->
      <span
        v-else-if="node.status !== 'pending'"
        class="person__name person__name--unknown"
        >—</span
      >
      <PartyChip v-for="party in parties" :key="party" :party />
    </div>

    <div v-if="node.status === 'pending'" class="person__pending">
      <v-progress-circular indeterminate size="18" width="2" />
    </div>

    <!-- Per node and not per page: one person's request failing is one card
         that could not be filled, and the rest of the chain is still worth
         reading. Only the focus person's failure turns the whole page into an
         error, and the page owns that. -->
    <div
      v-else-if="node.status === 'error'"
      class="k-note person__error"
      data-testid="chain-node-error"
    >
      <div class="person__error-line">
        <v-icon :icon="mdiAlertCircleOutline" size="15" />
        <span>Nie udało się wczytać tej osoby.</span>
      </div>
      <v-btn
        class="text-none person__retry"
        data-testid="chain-node-retry"
        density="comfortable"
        :prepend-icon="mdiRefresh"
        size="small"
        variant="text"
        @click="emit('retry', node.key)"
      >
        Spróbuj ponownie
      </v-btn>
    </div>

    <!-- Only under the person the page is about. Deeper in the chain the
         posts would be the same list for a different reason - the reader is
         there for the names, not for the career - and a card carrying six of
         them in a 260px column is a wall.

         Every post is listed, including the ones nobody matched, because the
         two dead ends are different answers: a post with no role CANNOT be
         matched to anybody (the register recorded none, and the seat is the
         whole key), while a post with a role and no candidates was looked at
         and came back empty. A reader who is told only "nothing found" cannot
         tell those apart, and 11,360 of 18,279 spells in the register are one
         or the other. -->
    <div
      v-if="isFocus && posts.length"
      class="k-note person__posts"
      data-testid="chain-posts"
    >
      <div class="sec-head">
        <v-icon class="sec-head__icon" :icon="mdiBriefcaseOutline" size="15" />
        <h3 class="text-subtitle-2 font-weight-bold">Stanowiska tej osoby</h3>
      </div>
      <p
        v-for="post in posts"
        :key="post.edgeId"
        class="person__post"
        data-testid="chain-post"
        :data-company="post.companyId"
      >
        <span v-if="!post.role" data-testid="chain-post-no-role">
          {{ post.companyName }} - w rejestrze nie ma funkcji dla tego wpisu,
          więc nie da się go z nikim zestawić.
        </span>
        <span v-else-if="!post.predecessorCount && !post.successorCount">
          {{ post.companyName }} · {{ post.role }} - nikt inny nie zajmował tej
          funkcji w oknie, które sprawdzamy.
        </span>
        <span v-else>
          {{ post.companyName }} · {{ post.role }} ·
          {{ shortDate(post.start) }} –
          {{ post.end ? shortDate(post.end) : "nadal" }} -
          {{ post.predecessorCount }} przed, {{ post.successorCount }} po
        </span>
      </p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import {
  mdiAlertCircleOutline,
  mdiBriefcaseOutline,
  mdiRefresh,
} from "@mdi/js";
import { computed } from "vue";
import { generateEntityUrl } from "~/composables/slugs";
import type { ChainNode } from "~/composables/successionChain";
import { shortDate } from "~~/shared/dates";

const props = defineProps<{
  node: ChainNode;
  /** Whether this is the person the page is about. Passed in rather than read
   * off `depth === 0`, for the same reason the composable hands the layouts a
   * `focusKey`: which node is the focus is the chain's business, and a card
   * that decides it for itself would have to be changed twice if the chain
   * ever re-rooted. */
  isFocus: boolean;
}>();

const emit = defineEmits<{
  (e: "retry", nodeKey: string): void;
}>();

const parties = computed(() => props.node.step?.parties ?? []);

const posts = computed(() => props.node.step?.posts ?? []);

const personUrl = computed(() =>
  generateEntityUrl(
    "person",
    props.node.personId,
    props.node.personName || undefined,
  ),
);
</script>

<style scoped>
/* `k-card`, `k-card--accent`, `k-note`, `sec-head`, `sec-head__icon` and
   `link-plain` are global (app.vue) and are never restated in a scoped block -
   the five components that copied them all drifted, and a reader reported the
   result twice. */

.person {
  padding: 9px 10px 10px 12px;
}

.person__head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.person__name {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 0.875rem;
  font-weight: 700;
  line-height: 1.35;
}

.person__name--unknown {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.person__pending {
  padding: 6px 0 2px;
}

.person__error {
  margin-top: 8px;
  padding: 8px 10px;
}

.person__error-line {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.6);
  display: flex;
  font-size: 0.75rem;
  gap: 6px;
  line-height: 1.4;
}

.person__retry {
  margin-left: -8px;
  margin-top: 2px;
}

.person__posts {
  margin-top: 10px;
  padding: 8px 10px 10px;
}

.person__post {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.6875rem;
  line-height: 1.45;
  margin-top: 4px;
}
</style>
