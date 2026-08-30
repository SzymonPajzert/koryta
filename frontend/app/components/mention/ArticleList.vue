<template>
  <!-- Nothing found, nothing said: most people in the graph are named in no
       article we hold, and a heading over empty space reads as a page that
       failed to load. The same rule `ExtractionPersonFacts` and
       `SuccessionPersonChanges` follow. -->
  <section v-if="mentions.length > 0" class="mt-4" data-testid="node-mentions">
    <div class="sec-head">
      <v-icon
        :icon="mdiNewspaperVariantOutline"
        size="18"
        class="sec-head__icon"
      />
      <h3 class="text-h6">Artykuły, które o tym wspominają</h3>
    </div>

    <p class="k-lead" data-testid="node-mentions-lead">
      Teksty prasowe, w których pada ta nazwa - z artykułów przeanalizowanych
      przez model i ze źródeł dodanych w notatkach.
    </p>

    <v-row dense>
      <v-col v-for="mention in mentions" :key="mention.edgeId" cols="12" md="6">
        <v-card
          variant="outlined"
          class="h-100"
          :to="articleUrl(mention)"
          data-testid="node-mention-card"
        >
          <v-card-text class="d-flex align-start ga-3 py-3">
            <v-avatar
              v-if="mention.sourceURL"
              :image="getDomainIcon(mention.sourceURL)"
              size="24"
              class="mt-1"
            />
            <div class="flex-grow-1 min-w-0">
              <div class="text-body-2 font-weight-medium">
                {{ mention.name ?? mention.nodeId }}
              </div>
              <div
                class="d-flex align-center flex-wrap ga-2 mt-1 text-caption text-medium-emphasis"
              >
                <span v-if="domainOf(mention)">{{ domainOf(mention) }}</span>
                <span v-if="dateOf(mention)">· {{ dateOf(mention) }}</span>
                <v-chip
                  v-if="!mention.published"
                  size="x-small"
                  variant="tonal"
                >
                  szkic
                  <v-tooltip activator="parent" location="top">
                    Powiązanie czeka na zatwierdzenie — widoczne tylko dla
                    zalogowanych.
                  </v-tooltip>
                </v-chip>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </section>
</template>

<script setup lang="ts">
/** The articles that name this person or company.
 *
 * A section of its own rather than more rows in the relation list: an article
 * is not a relation between two entities in the graph the way an employment is,
 * it is where a claim came from, and the reader wants it as a reading list.
 *
 * Fed by `/api/nodes/[id]/mentions` rather than by `useEdges`, which cannot
 * carry it - the local graph drops every edge whose far end is an article. The
 * markup on `EntityDetailView` that filtered `useEdges` for `mentions` was
 * therefore never able to render anything, and this replaces it.
 */
import { computed } from "vue";
import { mdiNewspaperVariantOutline } from "@mdi/js";
import { authFetch, useAuthState } from "~/composables/auth";
import { useDomainIcon } from "~/composables/useDomainIcon";
import { generateEntityUrl } from "~/composables/slugs";
import type {
  NodeMention,
  NodeMentions,
} from "~~/server/api/nodes/[id]/mentions.get";

const { nodeId } = defineProps<{ nodeId: string }>();

const { user } = useAuthState();
const { getDomainIcon } = useDomainIcon();

/** Said out loud rather than left to `authFetch`, the same as on the article
 * page: its `onRequest` hook returns early on the server, so a server rendered
 * page would ask without `latest` and a reader who just added a source would not
 * see the draft mention it created. */
const latest = computed(() => !!user.value);

// Not awaited, so the section resolving does not hold up the rest of the page -
// the same shape `ExtractionPersonFacts` uses. An error renders as an absent
// section rather than a broken one: this is a public page, and a press cuttings
// list failing to load is not a reason to show nothing else.
const { data } = authFetch<NodeMentions>(
  () => `/api/nodes/${nodeId}/mentions`,
  { query: computed(() => ({ latest: latest.value })) },
);

const mentions = computed(() => data.value?.mentions ?? []);

function articleUrl(mention: NodeMention) {
  return generateEntityUrl(
    "article",
    mention.nodeId,
    mention.name ?? undefined,
  );
}

function domainOf(mention: NodeMention) {
  if (!mention.sourceURL) return "";
  try {
    return new URL(mention.sourceURL).hostname.replace(/^www\./, "");
  } catch {
    return mention.sourceURL;
  }
}

function dateOf(mention: NodeMention) {
  if (!mention.publishedDate) return "";
  const date = new Date(mention.publishedDate);
  return isNaN(date.getTime()) ? "" : date.toLocaleDateString("pl-PL");
}
</script>

<style scoped>
.sec-head {
  align-items: center;
  display: flex;
  gap: 8px;
}

.sec-head__icon {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.k-lead {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.75rem;
  line-height: 1.5;
  margin: 4px 0 12px;
  max-width: 78ch;
}

.min-w-0 {
  min-width: 0;
}
</style>
