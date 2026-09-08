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
    <v-card class="mb-4">
      <v-card-item>
        <template #prepend>
          <v-icon :icon="mdiTagOutline" size="large" color="primary" />
        </template>
        <v-card-title class="text-h5 font-weight-bold text-wrap">
          {{ topic?.name }}
          <ChipDraftStatus
            :published="topicPublished"
            :node-id="topicId"
            :node-name="topic?.name"
            class="ml-2"
            @published="refresh()"
          />
        </v-card-title>
        <v-card-subtitle v-if="topic?.description" class="text-wrap">
          {{ topic.description }}
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
  </div>
</template>

<script setup lang="ts">
/** One story: what it is about, who is in it, and what it rests on. */
import { computed } from "vue";
import { mdiTagOutline } from "@mdi/js";
import { useCurrentUser } from "vuefire";
import { authFetch } from "~/composables/auth";
import { useDomainIcon } from "~/composables/useDomainIcon";
import { polishCounting } from "~/composables/polish";
import {
  parseEntityUrlSlug,
  generateEntityUrl,
  SLUG_REDIRECT_CODE,
} from "~/composables/slugs";
import { entityDescription, SOCIAL_CARD } from "~/composables/entitySeo";
import type { TopicArticle, TopicDetail } from "~~/server/api/topics/[id].get";

// No `fullWidth`: that is for /graf, which is a canvas edge to edge. A story is
// a page with a graph on it - a heading, a description, an article list - and
// reads like the article page it is reached from, in the same centred column.
definePageMeta({ title: "Temat" });

const route = useRoute();
const user = useCurrentUser();
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

// A topic reached by an out-of-date slug keeps working - the id is what
// resolves it - but the canonical url is the one worth sharing.
if (status.value === "success" && topic.value?.name) {
  const expected = generateEntityUrl("topic", topicId, topic.value.name);
  if (route.path !== expected) {
    if (import.meta.server) {
      await navigateTo(expected, { redirectCode: SLUG_REDIRECT_CODE });
    } else {
      await navigateTo(expected, { replace: true });
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
