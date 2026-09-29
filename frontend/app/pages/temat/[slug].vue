<template>
  <div v-if="status !== 'success'">
    <v-alert type="info" variant="tonal" class="ma-4">
      Nie znaleźliśmy takiego tematu, albo nie został jeszcze zatwierdzony.
      <template v-if="!user">
        Niezatwierdzone tematy widzą tylko zalogowani.
      </template>
    </v-alert>
  </div>

  <div v-else>
    <!-- Where /profil's „Podgląd tej wersji” and the history on /admin/rewizje
         lead: the page as a proposal would leave it, said out loud so nobody
         takes it for what the site shows. -->
    <v-alert
      v-if="preview"
      type="info"
      variant="tonal"
      class="mb-4"
      data-testid="topic-preview-notice"
    >
      Wyświetlasz podgląd zaproponowanej zmiany na tej stronie.
      <br />
      <nuxt-link :to="`/admin/rewizje/${topicId}?revisionId=${revisionId}`"
        >Zobacz historię zmian</nuxt-link
      >.
    </v-alert>

    <v-card class="mb-4">
      <v-card-item>
        <template #prepend>
          <v-icon :icon="mdiTagOutline" size="large" color="primary" />
        </template>
        <!-- The controls share the name's row rather than taking the card's
             `#append` column. That column runs the height of the item, so on
             a phone it would have held the lead under the name to a third of
             the screen; here they wrap onto a line of their own instead, and
             `ms-auto` keeps them at the right edge when they do. -->
        <v-card-title
          class="d-flex flex-wrap align-center ga-2 text-h5 font-weight-bold text-wrap"
        >
          <span data-testid="topic-name">{{ shown?.name }}</span>
          <ChipDraftStatus
            :published="topicPublished"
            :node-id="topicId"
            :node-name="topic?.name"
            @published="refresh()"
          />
          <div v-if="topic" class="d-flex align-center ga-2 ms-auto">
            <!-- Where the edits below are listed, and where one is taken back:
                 an admin's is live as soon as it is saved, so the history is
                 the only place its previous wording survives. -->
            <ButtonIconAction
              v-if="isAdmin"
              :icon="mdiHistory"
              label="Rewizje"
              :to="`/admin/rewizje/${topicId}`"
              data-testid="admin-revisions-link"
            />
            <!-- The name and the lead under it were editable nowhere, so a
                 wrong case ending in a lead had to be corrected in the
                 database by hand. Anybody may propose a change, as on any
                 other page; an admin's goes live on saving. -->
            <DialogProposeEditNode
              :entity="topic"
              :can-apply="isAdmin === true"
              skip-redirect
              data-testid="topic-edit"
              @submitted="onEdited"
            />
          </div>
        </v-card-title>
        <v-card-subtitle
          v-if="shown?.description"
          class="text-wrap"
          data-testid="topic-description"
        >
          {{ shown.description }}
        </v-card-subtitle>
      </v-card-item>
      <v-card-text class="pt-0 text-caption text-medium-emphasis">
        {{
          polishCounting(articles.length, "artykuł", "artykuły", "artykułów")
        }}
        w tym temacie.
      </v-card-text>
    </v-card>

    <ExploreLoginBanner
      v-if="!user"
      message="Zaloguj się, aby zobaczyć artykuły i powiązania, które czekają jeszcze na zatwierdzenie."
    />

    <!-- The point of the page: who is in this story. Articles are the evidence
         and are listed below, but they are not drawn - what a reader wants from
         a story is the people. -->
    <v-card class="mb-4">
      <v-card-title class="text-subtitle-1 font-weight-bold">
        Graf powiązań
      </v-card-title>
      <v-card-text>
        <GraphContainer
          :key="topicId"
          focus-node-id=""
          :source="graphSource"
          :height="560"
        />
        <p class="text-caption text-medium-emphasis mt-2">
          Pokazujemy osoby i instytucje wspomniane w artykułach z tego tematu
          oraz powiązania, dla których te artykuły są źródłem.
        </p>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold">
        Artykuły
      </v-card-title>
      <v-list v-if="articles.length" lines="two">
        <v-list-item
          v-for="article in articles"
          :key="article.id"
          :to="articleUrl(article)"
          :data-testid="'topic-article-' + article.id"
        >
          <template #prepend>
            <v-avatar
              v-if="article.sourceURL"
              :image="getDomainIcon(article.sourceURL)"
              size="24"
            />
          </template>
          <v-list-item-title class="text-wrap">
            {{ article.name }}
          </v-list-item-title>
          <v-list-item-subtitle>
            <span v-if="article.publishedDate">
              {{ new Date(article.publishedDate).toLocaleDateString("pl-PL") }}
            </span>
            <v-chip
              v-if="!article.taggedPublished"
              size="x-small"
              variant="outlined"
              class="ml-2"
            >
              tag oczekuje na zatwierdzenie
            </v-chip>
          </v-list-item-subtitle>
        </v-list-item>
      </v-list>
      <v-card-text v-else>
        Do tego tematu nie przypisano jeszcze żadnego artykułu. Możesz to zrobić
        ze strony artykułu.
      </v-card-text>
    </v-card>

    <!-- What happened to the change, since the two outcomes look alike from
         here: a proposal leaves the page as it was, exactly like a save that
         failed silently would. -->
    <v-snackbar
      :model-value="!!editOutcome"
      color="ink-info"
      :timeout="6000"
      data-testid="topic-edit-notice"
      @update:model-value="editOutcome = undefined"
    >
      {{ editOutcome ? EDIT_NOTICES[editOutcome] : "" }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
/** One story: what it is about, who is in it, and what it rests on. */
import { computed, ref } from "vue";
import { mdiHistory, mdiTagOutline } from "@mdi/js";
import { useCurrentUser } from "vuefire";
import { authFetch, useAuthState } from "~/composables/auth";
import { useDomainIcon } from "~/composables/useDomainIcon";
import { polishCounting } from "~/composables/polish";
import {
  parseEntityUrlSlug,
  generateEntityUrl,
  SLUG_REDIRECT_CODE,
} from "~/composables/slugs";
import { entityDescription, SOCIAL_CARD } from "~/composables/entitySeo";
import { topicPreview } from "~/utils/topicPreview";
import type { Revision } from "~~/shared/model";
import type { TopicArticle, TopicDetail } from "~~/server/api/topics/[id].get";

// No `fullWidth`: that is for /graf, which is a canvas edge to edge. A story is
// a page with a graph on it - a heading, a description, an article list - and
// reads like the article page it is reached from, in the same centred column.
definePageMeta({ title: "Temat" });

const route = useRoute();
const user = useCurrentUser();
const { isAdmin } = useAuthState();
const { getDomainIcon } = useDomainIcon();

const topicId = parseEntityUrlSlug(route.params.slug as string).id;

/** Asked for explicitly, because `authFetch`'s hook that would add it returns
 * early on the server - so a server rendered load would be handed the public
 * view and a curator would not see the story they are still assembling. */
const latest = computed(() => !!user.value);

const { data, status, refresh } = await authFetch<TopicDetail>(
  `/api/topics/${topicId}`,
  { query: computed(() => ({ latest: latest.value })) },
);

const topic = computed(() => data.value?.topic);

const revisionId = computed(() =>
  typeof route.query.revisionId === "string"
    ? route.query.revisionId
    : undefined,
);

const { data: revision } = await useAsyncData<Revision | null>(
  () => `topic-revision-${revisionId.value ?? "none"}`,
  () =>
    revisionId.value
      ? $fetch<Revision>(`/api/revisions/${revisionId.value}` as never)
      : Promise.resolve(null),
  { watch: [revisionId] },
);

/** A proposal's wording, where the url asks for one - see `topicPreview`. */
const preview = computed(() => topicPreview(topicId, revision.value));

/** The heading and the lead as drawn: a previewed proposal's, or the topic's
 * own. Only these two - the dialog still edits the stored topic, and the
 * title a search engine reads is never a proposal's. */
const shown = computed(() => preview.value ?? topic.value);
const topicPublished = computed(() => topic.value?.published === true);
const articles = computed<TopicArticle[]>(() => data.value?.articles ?? []);

/** The graph endpoint, with the same question in the url: `useGraph` passes it
 * to `authFetch` whole, so this is the only place that can say it. */
const graphSource = computed(
  () => `/api/graph/topic/${topicId}?latest=${latest.value}`,
);

function articleUrl(article: TopicArticle) {
  return generateEntityUrl("article", article.id, article.name);
}

/** What a save from the header came to. */
type EditOutcome = "applied" | "proposed" | "duplicate";

const EDIT_NOTICES: Record<EditOutcome, string> = {
  applied: "Zmiana zapisana.",
  proposed: "Propozycja zapisana i czeka na zatwierdzenie.",
  duplicate: "Tę zmianę już zgłosiłeś - czeka na zatwierdzenie.",
};

const editOutcome = ref<EditOutcome | undefined>(undefined);

/** Only an applied edit changes anything on the page, so only that one reads
 * the topic again - with `latest`, which is what an admin is signed in with,
 * and which reads past the server's cache.
 *
 * A renamed topic keeps the address it was opened at until the next load
 * redirects it, the way any out-of-date slug is: following it here would mount
 * the page afresh and take this notice down with the old one. */
async function onEdited(_id: string, duplicate?: boolean, applied?: boolean) {
  editOutcome.value = applied
    ? "applied"
    : duplicate
      ? "duplicate"
      : "proposed";
  if (applied) await refresh();
}

// A topic reached by an out-of-date slug keeps working - the id is what
// resolves it - but the canonical url is the one worth sharing. The query goes
// along: a preview link built from the name its proposal gave the topic
// arrives on exactly such a slug, and dropping `revisionId` on the way showed
// the reader the current text and no trace of what they had proposed.
if (status.value === "success" && topic.value?.name) {
  const expected = generateEntityUrl("topic", topicId, topic.value.name);
  if (route.path !== expected) {
    const to = { path: expected, query: route.query };
    if (import.meta.server) {
      await navigateTo(to, { redirectCode: SLUG_REDIRECT_CODE });
    } else {
      await navigateTo(to, { replace: true });
    }
  }
}

const seoTitle = computed(() => topic.value?.name ?? "Temat");

useSeoMeta({
  title: seoTitle,
  description: () => (topic.value ? entityDescription(topic.value) : null),
  ogTitle: seoTitle,
  ogImage: SOCIAL_CARD,
  twitterCard: "summary_large_image",
  twitterImage: SOCIAL_CARD,
});
</script>
