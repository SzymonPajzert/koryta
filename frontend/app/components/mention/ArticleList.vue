<template>
  <!-- Nothing found, nothing said: most people in the graph are named in no
       article we hold, and a heading over empty space reads as a page that
       failed to load. The same rule `ExtractionPersonFacts` and
       `SuccessionPersonChanges` follow. -->
  <PageSection
    v-if="mentions.length > 0 || declarations.length > 0"
    :id="declarations.length > 0 ? DECLARATIONS_ANCHOR : undefined"
    :title="sectionTitle"
    :icon="mdiNewspaperVariantOutline"
    class="mt-4 mention-section"
    data-testid="node-mentions"
  >
    <template #lead>
      <p class="k-lead" data-testid="node-mentions-lead">
        <template v-if="mentions.length > 0">
          Artykuły prasowe wspomniające osobę i dokumenty oświadczeń
          majątkowych.
        </template>
        <template v-if="declarations.length > 0">
          {{
            declarations.length > 1
              ? "Oświadczenia majątkowe z BIP mają tę samą datę urodzenia co ta osoba."
              : "Oświadczenie majątkowe z BIP ma tę samą datę urodzenia co ta osoba."
          }}
        </template>
      </p>
    </template>

    <v-row dense>
      <!-- The declarations first: on a page the site published because of
           them they are why the page is here. A card like an article's, but
           out to the office's own BIP rather than to a page of ours - a
           declaration is not an article and gets no page on the site. -->
      <v-col
        v-for="declaration in declarations"
        :key="declaration.url"
        cols="12"
        md="6"
        data-nosnippet
        data-testid="person-declarations"
      >
        <v-card
          variant="outlined"
          class="h-100"
          :href="declaration.url"
          target="_blank"
          rel="noopener"
          :aria-label="declarationLabel(declaration)"
        >
          <v-card-text class="d-flex align-start ga-3 py-3">
            <v-avatar
              :image="getDomainIcon(declaration.url)"
              size="24"
              class="mt-1"
            />
            <div class="flex-grow-1 min-w-0">
              <div class="text-body-2 font-weight-medium">
                {{ declarationTitle(declaration) }}
              </div>
              <div
                class="d-flex align-center flex-wrap ga-2 mt-1 text-caption text-medium-emphasis"
              >
                <span>{{ declarationPlace(declaration) }}</span>
                <span v-if="hostOf(declaration.url)"
                  >· {{ hostOf(declaration.url) }}
                  <v-icon :icon="mdiOpenInNew" size="12"
                /></span>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
      <!-- Keyed on the article, which the endpoint lists once, not on the
           edge: a relation citing two articles puts its id on both cards. -->
      <v-col v-for="mention in mentions" :key="mention.nodeId" cols="12" md="6">
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
  </PageSection>
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
 * therefore never able to render anything, and this replaces it. The endpoint
 * also counts the articles this node's relations cite as their source: the
 * piece that says who sits on which board names both of them.
 */
import { computed } from "vue";
import { mdiNewspaperVariantOutline, mdiOpenInNew } from "@mdi/js";
import { authFetch, useAuthState } from "~/composables/auth";
import {
  DECLARATIONS_ANCHOR,
  uniqueDeclarations,
  usePersonDeclarations,
} from "~/composables/personDeclarations";
import { useDomainIcon } from "~/composables/useDomainIcon";
import { generateEntityUrl } from "~~/shared/slugs";
import type {
  NodeMention,
  NodeMentions,
} from "~~/server/api/nodes/[id]/mentions.get";

const { nodeId, withDeclarations = false } = defineProps<{
  nodeId: string;
  /** A person's page also lists their asset declarations on BIP here, with
   * the articles, rather than in a section of their own that would say the
   * same twice (round bip-osoba-r1). */
  withDeclarations?: boolean;
}>();

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

const declarationData = withDeclarations
  ? usePersonDeclarations(nodeId).data
  : ref(null);
const declarations = computed(() => uniqueDeclarations(declarationData.value));

type Declaration = (typeof declarations.value)[number];

/** The section's name for what it holds: articles, or a person's own
 * declarations, or both. A declaration does not mention the person - it is
 * theirs - so on its own it is called what it is. */
const sectionTitle = computed(() => {
  if (declarations.value.length === 0)
    return "Artykuły, które o tym wspominają";
  if (mentions.value.length === 0) {
    return declarations.value.length > 1
      ? "Oświadczenia majątkowe"
      : "Oświadczenie majątkowe";
  }
  // Round bip-osoba-r2's title for the two together.
  return "Prasa i dokumenty";
});

function declarationTitle(declaration: Declaration) {
  return declaration.year
    ? `Oświadczenie majątkowe za ${declaration.year}`
    : "Oświadczenie majątkowe";
}

/** „Rada gminy · Strzelin (gmina miejsko-wiejska)”: the office before the
 * unit, joined rather than declined - „Rada Gminy Strzelin” would take a
 * grammar of Polish place names the site does not have. */
function declarationPlace(declaration: Declaration) {
  return [declaration.office, declaration.unit].filter(Boolean).join(" · ");
}

/** What a screen reader says for the card: its title first, so a reader who
 * steers by voice can name it by what they see, then where it opens. */
function declarationLabel(declaration: Declaration) {
  return [
    declarationTitle(declaration),
    declarationPlace(declaration),
    hostOf(declaration.url),
    "otwiera się w nowej karcie",
  ]
    .filter(Boolean)
    .join(", ");
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

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
.min-w-0 {
  min-width: 0;
}

/* Clear of the app bar when the header's line scrolls here. */
.mention-section {
  scroll-margin-top: 80px;
}
</style>
