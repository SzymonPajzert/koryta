<template>
  <div style="width: 100%">
    <v-card v-if="status !== 'success'" class="mb-4">
      <v-card-title>{{
        user ? "Nie udało się wczytać artykułu" : "Dostęp zastrzeżony"
      }}</v-card-title>
      <v-card-text class="pt-0">
        <p v-if="!user" class="mb-4">
          Ta strona nie została znaleziona lub oczekuje na zatwierdzenie.
          Niezaakceptowane strony są widoczne tylko dla zalogowanych
          użytkowników.
        </p>
        <v-alert v-else type="warning" variant="tonal" class="mb-4">
          Prawdopodobnie artykuł nie istnieje, został usunięty lub nie masz do
          niego dostępu.
        </v-alert>
        <v-btn v-if="!user" color="primary" @click="handleLoginRedirect()">
          Zaloguj się
        </v-btn>
        <v-btn
          v-else
          color="primary"
          variant="tonal"
          :prepend-icon="mdiRefresh"
          @click="refreshNode()"
        >
          Odśwież
        </v-btn>
      </v-card-text>
    </v-card>

    <v-card v-else width="100%">
      <div class="pa-4">
        <!-- 1. What this is, and where it came from -->
        <div class="d-flex align-start ga-3 mb-2">
          <v-avatar
            v-if="article?.sourceURL"
            :image="getDomainIcon(article.sourceURL)"
            size="32"
            class="mt-1"
          />
          <div class="flex-grow-1">
            <h1 class="text-h5 font-weight-bold text-wrap">
              {{ article?.name }}
            </h1>
            <div
              class="d-flex align-center flex-wrap ga-2 mt-1 text-caption text-medium-emphasis"
            >
              <a
                v-if="article?.sourceURL"
                :href="article.sourceURL"
                target="_blank"
                rel="noopener"
                class="d-inline-flex align-center"
              >
                {{ domain }}
                <v-icon :icon="mdiOpenInNew" size="x-small" class="ml-1" />
              </a>
              <span v-if="publishedDate">· {{ publishedDate }}</span>
              <span v-if="author">· {{ author }}</span>
              <v-chip v-if="!isPublished" size="x-small" variant="tonal">
                szkic
              </v-chip>
              <ArticleCaptureStatus v-if="capture" :capture="capture" />
            </div>
          </div>
        </div>

        <!-- 2. Which story it belongs to -->
        <v-divider class="my-3" />
        <h2 class="text-subtitle-1 font-weight-bold mb-2">Tematy</h2>
        <ArticleTopicChips
          :topics="topics"
          :can-edit="!!user"
          :can-approve="!!isAdmin"
          :saving="savingTopics"
          @add="addTopic"
          @remove="removeTopic"
          @approve="approveTopic"
        />
        <v-alert
          v-if="topicError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-2"
        >
          {{ topicError }}
        </v-alert>

        <!-- 3. What the extractor made of it -->
        <v-divider class="my-4" />
        <!-- Closed to begin with: a long article yields a dozen cards, and
             they used to push everything a reader came for - who is in the
             article, and what rests on it - a screen and a half down. The
             count in the header is what a closed section owes them, so that
             opening it is a decision rather than a guess. -->
        <div
          class="d-flex align-center ga-2 mb-2"
          :class="user ? 'cursor-pointer' : ''"
          :role="user ? 'button' : undefined"
          :tabindex="user ? 0 : undefined"
          :aria-expanded="user ? factsOpen : undefined"
          data-testid="article-facts-header"
          @click="user && (factsOpen = !factsOpen)"
          @keydown.enter.prevent="user && (factsOpen = !factsOpen)"
          @keydown.space.prevent="user && (factsOpen = !factsOpen)"
        >
          <h2 class="text-subtitle-1 font-weight-bold">Wydobyte fakty</h2>
          <!-- Only a signed in reader is served the facts, so only they are
               given a number rather than a zero that means "not for you". -->
          <template v-if="user">
            <v-chip
              size="x-small"
              variant="tonal"
              data-testid="article-facts-count"
            >
              {{ facts.length }}
            </v-chip>
            <v-icon
              :icon="factsOpen ? mdiChevronUp : mdiChevronDown"
              size="small"
              class="text-medium-emphasis"
            />
          </template>
        </div>
        <ExploreLoginBanner
          v-if="!user"
          message="Zaloguj się, aby zobaczyć fakty wydobyte z tego artykułu przez model."
        />
        <v-expand-transition v-else>
          <!-- `v-if`, not `v-show`: every card carries vote buttons, and each
               of those opens a vuefire subscription on the fact's vote
               document. A closed section should not be holding a dozen of
               them - the same reason ExtractionArticleGroup mounts its cards
               only when it is opened. -->
          <div v-if="factsOpen" data-testid="article-facts-body">
            <div v-if="facts.length" data-testid="article-facts">
              <ExtractionCard
                v-for="fact in facts"
                :key="fact.id ?? fact.url"
                :fact="fact"
                can-promote
                class="mb-3"
              >
                <template #actions>
                  <ExtractionVoteButtons v-if="fact.id" :id="fact.id" />
                </template>
              </ExtractionCard>
            </div>
            <v-alert v-else type="info" variant="tonal" density="compact">
              Z tego artykułu nie wydobyto jeszcze żadnych faktów.
            </v-alert>
          </div>
        </v-expand-transition>

        <!-- 4. Who it talks about -->
        <template v-if="mentions.length || user">
          <v-divider class="my-4" />
          <h2 class="text-subtitle-1 font-weight-bold mb-2">
            Wspomniane osoby i instytucje
          </h2>
          <ArticleMentionChips
            :mentions="mentions"
            :can-edit="!!user"
            :saving="savingMentions"
            @add="addMention"
            @remove="removeMention"
          />
          <v-alert
            v-if="mentionError"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-2"
          >
            {{ mentionError }}
          </v-alert>
        </template>

        <!-- 5. What rests on it, and adding to that -->
        <v-divider class="my-4" />
        <!-- Wrapped so the visual suite can capture the section on its own:
             the page below it draws a force-directed graph, which settles
             somewhere slightly different on every run. -->
        <div data-testid="article-sources-section">
          <div class="d-flex align-center flex-wrap ga-2 mb-2">
            <h2 class="text-subtitle-1 font-weight-bold">
              Artykuł stanowi źródło dla
            </h2>
            <v-spacer />
            <v-btn
              color="primary"
              variant="tonal"
              size="small"
              :prepend-icon="mdiPlus"
              data-testid="article-add-sourced-edge"
              @click="openAddEdge()"
            >
              Dodaj powiązanie
            </v-btn>
            <!-- The claim is often already in the base, made from some other
                 article; then the thing to add is this article behind it, not a
                 second copy of the relation. -->
            <v-btn
              color="primary"
              variant="text"
              size="small"
              :prepend-icon="mdiLinkVariantPlus"
              data-testid="article-cite-existing-edge"
              @click="openCiteExisting()"
            >
              Istniejące powiązanie
            </v-btn>
          </div>
          <ArticleSourcedEdgeList
            :edges="sourcedEdges"
            :can-edit="!!user"
            :removing="detaching"
            @detach="detachSource"
          />
        </div>

        <ArticleAddSourcedEdgeDialog
          v-if="article"
          v-model="addEdgeOpen"
          :article-id="nodeId"
          :article-name="article.name"
          @added="refreshSourced()"
        />

        <ArticleCiteExistingEdgeDialog
          v-if="article"
          v-model="citeExistingOpen"
          :article-id="nodeId"
          :article-name="article.name"
          @added="refreshSourced()"
        />

        <!-- 6. The people behind it -->
        <template v-if="graphNodeIds.length">
          <v-divider class="my-4" />
          <h2 class="text-subtitle-1 font-weight-bold mb-2">Graf powiązań</h2>
          <LazyGraphContainer
            :key="nodeId"
            focus-node-id=""
            :source="graphSource"
            :height="460"
          />
          <p class="text-caption text-medium-emphasis mt-2">
            Pokazujemy osoby i instytucje wspomniane w tym artykule, powiązania,
            dla których jest on źródłem, oraz najbliższe otoczenie wspomnianych
            osób.
          </p>
        </template>

        <!-- 7. What readers have made of it -->
        <v-divider class="my-4" />
        <!-- Both halves of the same thing: the notes filed against this piece
             from the pages it is about, and the box for adding one from here.
             The join is `NoteSource.articleNodeId`, which promoting a source
             stamps on the entry - so a url somebody kept under a person shows
             up here, next to their reason for keeping it. -->
        <ArticleCitedNotes :node-id="nodeId" />

        <NoteEditor :node-id="nodeId" node-type="article" class="mt-4" />
      </div>

      <v-divider />

      <div v-if="user" class="pa-4">
        <CommentsSection :node-id="nodeId" />
      </div>
    </v-card>
  </div>
</template>

<script setup lang="ts">
/** Everything worth knowing about one article, on its own page.
 *
 * Split out of `EntityDetailView` rather than added to it: that component is
 * mostly person, place and region branching, and an article shares almost none
 * of it. It also could not have worked here - `useEdges` reads the local graph,
 * which drops every edge touching an article, so an article's own relations
 * have to come from `/api/articles/[id]/relations`.
 */
import { computed, ref } from "vue";
import {
  mdiChevronDown,
  mdiChevronUp,
  mdiLinkVariantPlus,
  mdiOpenInNew,
  mdiPlus,
  mdiRefresh,
} from "@mdi/js";
import { authFetch, authRequest, useAuthState } from "~/composables/auth";
import { useDomainIcon } from "~/composables/useDomainIcon";
import { useExtractions } from "~/composables/extractions";
import { useCanCapture } from "~/composables/captures";
import { entityDescription, SOCIAL_CARD } from "~/composables/entitySeo";
import type { Article, Link, NodeType } from "~~/shared/model";
import type { ArticleCapture } from "~~/shared/capture";
import type {
  ArticleRelation,
  ArticleRelations,
} from "~~/server/api/articles/[id]/relations.get";
import type { SourcedEdge } from "~~/server/api/edges/byReference.get";
import CommentsSection from "@/components/comment/CommentsSection.vue";

const props = defineProps<{ nodeId: string }>();

const nodeId = props.nodeId;
const { user, isAdmin } = useAuthState();
const route = useRoute();
const router = useRouter();
const { getDomainIcon } = useDomainIcon();

function handleLoginRedirect() {
  router.push({ path: "/login", query: { redirect: route.fullPath } });
}

const {
  data: nodeResponse,
  status,
  refresh: refreshNode,
} = await authFetch<{ node: Article }>(`/api/nodes/${nodeId}`);

const article = computed(() => nodeResponse.value?.node);
const isPublished = computed(() => article.value?.published === true);

const domain = computed(() => {
  const url = article.value?.sourceURL;
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
});

const publishedDate = computed(() => {
  const raw = article.value?.publishedDate as unknown;
  if (!raw) return "";
  // Firestore timestamps arrive over SSR as `{ _seconds }`, and as an ISO
  // string once they have been through a revision.
  const seconds = (raw as { _seconds?: number })._seconds;
  const date = seconds ? new Date(seconds * 1000) : new Date(String(raw));
  return isNaN(date.getTime()) ? "" : date.toLocaleDateString("pl-PL");
});

/** The ld+json the scraper kept, when it named an author. Its shape varies by
 * publisher, so anything unrecognised is left out rather than guessed at. */
const author = computed(() => {
  const meta = article.value?.meta as { author?: unknown } | undefined;
  const raw = meta?.author;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const names = raw
      .map((entry) => (entry as { name?: string } | null)?.name)
      .filter((name): name is string => typeof name === "string");
    return names.join(", ");
  }
  return (raw as { name?: string } | undefined)?.name ?? "";
});

// The capture is datascience-only; anyone else simply gets no chip.
const canCapture = useCanCapture();
const capture = ref<ArticleCapture | undefined>(undefined);
watchEffect(async () => {
  if (!canCapture.value || !article.value?.sourceURL) return;
  try {
    const response = await authRequest<{ captures: ArticleCapture[] }>(
      "/api/pages",
      { method: "GET", query: { url: article.value.sourceURL, limit: 1 } },
    );
    capture.value = response.captures[0];
  } catch {
    capture.value = undefined;
  }
});

/** Whether to ask for drafts, said out loud rather than left to `authFetch`.
 *
 * Its `onRequest` hook returns early on the server, so a server rendered page -
 * every full load and every reload - would ask without `latest` and be handed
 * the public view. A signed in reader would tag an article, see the chip, and
 * find it gone the moment they refreshed. Reactive so that the fetch runs again
 * once auth resolves on the client, which is the same shape `useEdges` uses.
 */
const latest = computed(() => !!user.value);

const { data: relations, refresh: refreshRelations } =
  await authFetch<ArticleRelations>(`/api/articles/${nodeId}/relations`, {
    query: computed(() => ({ latest: latest.value })),
  });
const topics = computed(() => relations.value?.topics ?? []);
const mentions = computed(() => relations.value?.mentions ?? []);

const { data: sourcedResponse, refresh: refreshSourced } = await authFetch<{
  edges: SourcedEdge[];
}>("/api/edges/byReference", {
  query: computed(() => ({ articleId: nodeId, latest: latest.value })),
});
const sourcedEdges = computed(() => sourcedResponse.value?.edges ?? []);

const { data: extractions } = useExtractions({
  articleUrl: computed(() => article.value?.sourceURL),
});
const facts = computed(() => extractions.value?.facts ?? []);
const factsOpen = ref(false);

/** Whether there is anything to draw.
 *
 * An article is not a node in its own graph, so with nothing else the canvas
 * comes back empty and the section is worth nothing. The people the article
 * puts on the record are what it draws - the ones it names, and the ones joined
 * by a relation citing it.
 */
const graphNodeIds = computed(() => {
  const fromEdges = sourcedEdges.value.flatMap((edge) => [
    edge.source,
    edge.target,
  ]);
  const fromMentions = mentions.value
    .filter((mention) => mention.nodeType !== "topic")
    .map((mention) => mention.nodeId);
  return Array.from(new Set([...fromEdges, ...fromMentions]));
});

/** The layout itself comes from the server, the same shape a topic's does.
 * Drawing the local neighbourhood of whichever person came first answered a
 * different question: it showed that person's employers, and anybody else the
 * article named appeared only if they happened to fall within a hop. */
const graphSource = computed(
  () => `/api/graph/article/${nodeId}?latest=${latest.value}`,
);

const savingTopics = ref(false);
const topicError = ref<string | null>(null);

async function changeTopics(body: { add?: string[]; remove?: string[] }) {
  savingTopics.value = true;
  topicError.value = null;
  try {
    await authRequest(`/api/articles/${nodeId}/topics`, {
      method: "POST",
      body,
    });
    await refreshRelations();
  } catch (e: unknown) {
    const data = (e as { data?: { message?: string } } | null)?.data;
    topicError.value =
      data?.message ||
      (e instanceof Error ? e.message : "") ||
      "Nie udało się zapisać tematu.";
  } finally {
    savingTopics.value = false;
  }
}

const savingMentions = ref(false);
const mentionError = ref<string | null>(null);

/** Records who the article names, or takes a name off it.
 *
 * Same shape as `changeTopics`, and the same terms: additive, written as a
 * draft, and the list is re-read from the server rather than patched here.
 */
async function changeMentions(body: { add?: string[]; remove?: string[] }) {
  savingMentions.value = true;
  mentionError.value = null;
  try {
    await authRequest(`/api/articles/${nodeId}/mentions`, {
      method: "POST",
      body,
    });
    await refreshRelations();
  } catch (e: unknown) {
    const data = (e as { data?: { message?: string } } | null)?.data;
    mentionError.value =
      data?.message ||
      (e instanceof Error ? e.message : "") ||
      "Nie udało się zapisać wspomnianej osoby.";
  } finally {
    savingMentions.value = false;
  }
}

const addMention = (mention: Link<NodeType>) =>
  changeMentions({ add: [mention.id] });
const removeMention = (mention: ArticleRelation) =>
  changeMentions({ remove: [mention.nodeId] });

const addTopic = (topic: Link<NodeType>) => changeTopics({ add: [topic.id] });
const removeTopic = (topic: ArticleRelation) =>
  changeTopics({ remove: [topic.nodeId] });

/** Puts the story live along with this tag.
 *
 * Both in one call: a tag is an edge, and no edge may be published while an end
 * of it is a draft - so a tag whose topic nobody has approved never reaches
 * /admin/krawedzie at all, and this is the only place it is visible to act on.
 */
async function approveTopic(topic: ArticleRelation) {
  savingTopics.value = true;
  topicError.value = null;
  try {
    await authRequest(`/api/topics/${topic.nodeId}/approve`, {
      method: "POST",
      body: { edgeIds: [topic.edgeId] },
    });
    await refreshRelations();
  } catch (e: unknown) {
    const data = (e as { data?: { message?: string } } | null)?.data;
    topicError.value =
      data?.message ||
      (e instanceof Error ? e.message : "") ||
      "Nie udało się zatwierdzić tematu.";
  } finally {
    savingTopics.value = false;
  }
}

const addEdgeOpen = ref(false);
function openAddEdge() {
  if (!user.value) {
    handleLoginRedirect();
    return;
  }
  addEdgeOpen.value = true;
}

const citeExistingOpen = ref(false);
function openCiteExisting() {
  if (!user.value) {
    handleLoginRedirect();
    return;
  }
  citeExistingOpen.value = true;
}

const detaching = ref<string | null>(null);
async function detachSource(edge: SourcedEdge) {
  detaching.value = edge.id;
  try {
    await authRequest(`/api/edges/${edge.id}/references`, {
      method: "POST",
      body: { remove: [nodeId] },
    });
    await refreshSourced();
  } finally {
    detaching.value = null;
  }
}

const seoTitle = computed(() =>
  status.value === "success"
    ? (article.value?.name ?? "Artykuł")
    : "Strona nieznaleziona",
);

useSeoMeta({
  title: seoTitle,
  description: () =>
    article.value
      ? entityDescription(article.value, sourcedEdges.value.length)
      : null,
  ogTitle: seoTitle,
  ogType: "article",
  ogImage: SOCIAL_CARD,
  twitterCard: "summary_large_image",
  twitterImage: SOCIAL_CARD,
});
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}
</style>
