<template>
  <div>
    <v-card class="mb-4">
      <v-card-title><h1>Tematy</h1></v-card-title>
      <v-card-text>
        Sprawy, które śledzimy przez wiele artykułów naraz. Każdy temat pokazuje
        graf osób i instytucji powiązanych przez te artykuły.
      </v-card-text>
    </v-card>

    <ExploreLoginBanner
      v-if="!user"
      message="Zaloguj się, aby zobaczyć tematy, które czekają jeszcze na zatwierdzenie."
    />

    <v-row v-if="topics.length">
      <v-col v-for="topic in topics" :key="topic.id" cols="12" md="6">
        <v-card
          :to="topicUrl(topic)"
          height="100%"
          :data-testid="'topic-card-' + topic.id"
        >
          <v-card-item>
            <template #prepend>
              <v-icon :icon="mdiTagOutline" color="primary" />
            </template>
            <v-card-title class="text-wrap">
              {{ topic.name }}
              <v-chip
                v-if="!topic.published"
                size="x-small"
                variant="tonal"
                class="ml-2"
              >
                szkic
              </v-chip>
            </v-card-title>
            <v-card-subtitle>
              {{
                polishCounting(
                  topic.articleCount,
                  "artykuł",
                  "artykuły",
                  "artykułów",
                )
              }}
            </v-card-subtitle>
          </v-card-item>
          <v-card-text v-if="topic.description" class="text-wrap">
            {{ topic.description }}
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-alert v-else type="info" variant="tonal">
      Nie ma jeszcze żadnego tematu. Temat zakłada się ze strony artykułu -
      wpisz nazwę w polu "Dodaj do tematu".
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiTagOutline } from "@mdi/js";
import { useCurrentUser } from "vuefire";
import { authFetch } from "~/composables/auth";
import { polishCounting } from "~/composables/polish";
import { generateEntityUrl } from "~/composables/slugs";
import type { TopicSummary } from "~~/server/api/topics/index.get";

definePageMeta({ title: "Tematy" });

const user = useCurrentUser();
// Explicit, not left to `authFetch`: its hook returns early on the server, so a
// server rendered load would hide every draft topic from whoever made it.
const { data } = await authFetch<{ topics: TopicSummary[] }>("/api/topics", {
  query: computed(() => ({ latest: !!user.value })),
});
const topics = computed<TopicSummary[]>(() => data.value?.topics ?? []);

function topicUrl(topic: TopicSummary) {
  return generateEntityUrl("topic", topic.id, topic.name);
}

useSeoMeta({
  title: "Tematy",
  description:
    "Sprawy, które śledzimy przez wiele artykułów naraz - kto jest w każdej z nich i jak te osoby są ze sobą powiązane.",
});
</script>
