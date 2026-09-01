<template>
  <v-row cols="12">
    <!-- Folded, not moved. Six lines on a desktop are sixteen on a phone, so
         this notice was 380px of the first screen and a reader looking for the
         list of articles met a legal disclaimer instead of it. It stays first
         on the page, because that is where a disclaimer belongs and moving it
         under a fifty-row table would be hiding it - but as one line that opens
         rather than as the page's opening paragraph. -->
    <v-col cols="12">
      <v-expansion-panels variant="accordion">
        <v-expansion-panel>
          <v-expansion-panel-title class="text-body-2">
            Na czym opiera się ta strona i czego nie twierdzimy
          </v-expansion-panel-title>
          <v-expansion-panel-text class="text-body-2 pt-2">
            Niniejsza strona została utworzona na podstawie materiałów
            prasowych, informacji zawartych w Krajowym Rejestrze Sądowym, a
            także w oparciu o inne ogólnodostępne źródła. Strona wskazuje
            wybrane powiązania o charakterze biznesowym, rodzinnym lub innym
            łączące niektóre osoby zatrudnione w spółkach, fundacjach i
            organizacjach zarządzanych przez organy polskiego państwa.
            Powiązanie, które zdołaliśmy ustalić i które w naszej opinii są
            istotne dla całościowego spojrzenia na proces wybierania ludzi na
            stanowiska poza konkursami. Zastrzegamy, że celem strony nie jest
            twierdzenie, że wszystkie osoby uwidocznione na mapie działają
            wspólnie lub w porozumieniu, jak również przesądzanie o
            czyjejkolwiek osobistej winie lub odpowiedzialności prawnej.
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-col>

    <v-col cols="12">
      <v-card class="mb-6 pa-4">
        <h4 class="text-subtitle-1 mb-2">Dodaj nowy artykuł</h4>
        <v-form class="d-flex align-center" @submit.prevent="addArticle">
          <v-text-field
            v-model="newArticleUrl"
            label="Adres URL artykułu"
            variant="outlined"
            density="compact"
            hide-details
            class="mr-4"
            :loading="isAdding"
            autocomplete="off"
          />
          <v-btn
            type="submit"
            color="primary"
            :loading="isAdding"
            :disabled="!newArticleUrl"
          >
            Dodaj
          </v-btn>
        </v-form>

        <v-alert
          v-if="alertMessage"
          :type="alertType"
          class="mt-4"
          closable
          @click:close="alertMessage = ''"
        >
          {{ alertMessage }}
        </v-alert>

        <div v-if="canCapture" class="d-flex align-center flex-wrap ga-2 mt-4">
          <span class="text-body-2 text-medium-emphasis">
            Artykuł za paywallem? Dodanie samego adresu pobierze tylko zajawkę.
          </span>
          <v-spacer />
          <v-btn
            variant="text"
            size="small"
            :prepend-icon="mdiPuzzleOutline"
            to="/rozszerzenie"
          >
            Rozszerzenie
          </v-btn>
          <v-btn
            variant="tonal"
            size="small"
            :prepend-icon="mdiCodeTags"
            @click="pasteDialogOpen = true"
          >
            Wklej treść
          </v-btn>
        </div>
      </v-card>

      <ArticlePasteCaptureDialog
        v-model="pasteDialogOpen"
        @submitted="onCaptureSubmitted"
      />
    </v-col>

    <v-col cols="12">
      <h3 class="text-h6 font-weight-bold mb-4">
        Źródła tej strony to między innymi:
      </h3>
      <v-data-table-server
        v-model:page="page"
        v-model:items-per-page="itemsPerPage"
        :headers="headers"
        :items="sortedArticles"
        :items-length="articleCount"
        :items-per-page-options="[25, 50, 100]"
        mobile-breakpoint="md"
        hover
      >
        <template #[`header.publishedDate`]="{ column }">
          <span class="d-inline-flex align-center">
            {{ column.title }}
            <v-icon
              :icon="mdiArrowDown"
              size="small"
              class="ml-1 text-medium-emphasis"
            ></v-icon>
          </span>
        </template>
        <template #[`item.name`]="{ item }">
          <div class="d-flex align-center zrodla-title-cell">
            <v-avatar
              v-if="item.sourceURL"
              :image="getDomainIcon(item.sourceURL)"
              size="x-small"
              class="mr-2 flex-shrink-0"
            />
            <!-- Our page for the article rather than the publisher's. The
                 outbound link lives there, beside everything else we know
                 about the article - and that page is the only place a reader
                 can put it in a temat or cite a relation to it, which nothing
                 linked to before. -->
            <NuxtLink
              v-if="articleUrl(item)"
              :to="articleUrl(item)!"
              class="zrodla-link zrodla-title"
              :title="item.name"
              data-testid="zrodla-article-link"
            >
              {{ item.name }}
            </NuxtLink>
            <span v-else class="zrodla-title" :title="item.name">{{
              item.name
            }}</span>
          </div>
        </template>
        <template #[`item.publishedDate`]="{ item }">
          {{ formatDate(item.publishedDate) }}
        </template>
        <template #[`item.topics`]="{ item }">
          <div class="d-flex flex-wrap ga-1 py-1">
            <v-chip
              v-for="topic in topicsFor(item.id)"
              :key="topic.id"
              :to="generateEntityUrl('topic', topic.id, topic.name)"
              :variant="topic.published ? 'tonal' : 'outlined'"
              :prepend-icon="mdiTagOutline"
              size="small"
              color="primary"
              data-testid="zrodla-topic-chip"
            >
              {{ topic.name }}
              <v-tooltip
                v-if="!topic.published"
                activator="parent"
                location="top"
              >
                Oczekuje na zatwierdzenie — widoczne tylko dla zalogowanych.
              </v-tooltip>
            </v-chip>
            <span
              v-if="!topicsFor(item.id).length"
              class="text-caption text-medium-emphasis"
            >
              —
            </span>
          </div>
        </template>
        <template #[`item.capture`]="{ item }">
          <ArticleCaptureStatus :capture="forUrl(item.sourceURL)" />
        </template>
      </v-data-table-server>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import {
  mdiArrowDown,
  mdiCodeTags,
  mdiPuzzleOutline,
  mdiTagOutline,
} from "@mdi/js";
import { useEntities } from "~/composables/entity";
import { articlePayloadFor, ensureArticle } from "~/composables/articles";
import { useCurrentUser } from "vuefire";
import type { Timestamp } from "firebase-admin/firestore";
import { useDomainIcon } from "~/composables/useDomainIcon";
import { useCanCapture, useCaptures } from "~/composables/captures";
import { generateEntityUrl } from "~/composables/slugs";
import { authFetch } from "~/composables/auth";
import type { ArticleTopics } from "~~/server/api/articles/topics.get";

definePageMeta({
  title: "Źródła",
  affineLink: "BBMIZtWOoDBTDknqC82Ms",
});

const page = ref(1);
const itemsPerPage = ref(50);

// Asked for one page at a time rather than one fixed slice. The table used to
// be handed the newest hundred and left to page within them, so the older
// articles - most of what /zrodla is a list of - had no way of being reached.
//
// `items-per-page-options` is spelled out because Vuetify's default set ends in
// "wszystkie", and `limit=-1` is not something the api can be asked for.
const {
  entities: articles,
  total: articleCount,
  refresh: refreshArticles,
} = useEntities(
  "article",
  computed(() => ({
    limit: itemsPerPage.value,
    page: page.value,
    sortBy: "publishedDate",
    sortDesc: "true",
  })),
);
const user = useCurrentUser();
const { getDomainIcon } = useDomainIcon();

// One request for the whole table rather than one per row, and `latest` said
// out loud: `authFetch`'s hook returns early on the server, so a server
// rendered load would drop every draft tag from whoever just made it.
const { data: articleTopics } = await authFetch<ArticleTopics>(
  "/api/articles/topics",
  { query: computed(() => ({ latest: !!user.value })) },
);

function topicsFor(articleId?: string) {
  if (!articleId) return [];
  return articleTopics.value?.byArticle[articleId] ?? [];
}

/** Where the article's own page lives, when the row has an id to build it from.
 * A row without one is rendered as plain text rather than linked somewhere
 * wrong. */
function articleUrl(article: { id?: string; name?: string }) {
  return article.id
    ? generateEntityUrl("article", article.id, article.name)
    : undefined;
}

type FirestoreTimestamp = {
  _seconds: number;
  _nanoseconds: number;
};

function getDateValue(dateVal: FirestoreTimestamp | undefined): number {
  if (!dateVal) return 0;
  return dateVal._seconds * 1000;
}

const sortedArticles = computed(() => {
  return Object.values(articles.value || {})
    .map((article) => ({
      ...article,
      publishedDate: article.publishedDate,
    }))
    .sort((a, b) => {
      if (!a.publishedDate && !b.publishedDate) return 0;
      if (!a.publishedDate) return 1;
      if (!b.publishedDate) return -1;
      return (
        // TODO the type of this field is a bit messy right now, why we have only _seconds available
        getDateValue(b.publishedDate as unknown as FirestoreTimestamp) -
        getDateValue(a.publishedDate as unknown as FirestoreTimestamp)
      );
    });
});

// Whether we hold the article's text, and what came out of it, is only useful
// (and only readable) to the people who can capture pages — everyone else gets
// the list exactly as it was.
const canCapture = useCanCapture();
const { forUrl, refresh: refreshCaptures } = useCaptures(canCapture);
const pasteDialogOpen = ref(false);

const headers = computed(() => [
  { title: "Tytuł", key: "name", sortable: false },
  { title: "Data publikacji", key: "publishedDate", sortable: false },
  { title: "Tematy", key: "topics", sortable: false },
  ...(canCapture.value
    ? [{ title: "Treść", key: "capture", sortable: false }]
    : []),
]);

const newArticleUrl = ref("");
const isAdding = ref(false);
const alertMessage = ref("");
const alertType = ref<"success" | "error" | "info" | "warning">("success");

async function onCaptureSubmitted() {
  alertMessage.value =
    "Zapisano treść. Fakty pojawią się w kolejce za kilkanaście sekund.";
  alertType.value = "success";
  await Promise.all([refreshArticles(), refreshCaptures()]);
}

async function addArticle() {
  if (!user.value) {
    return navigateTo({
      path: "/login",
      query: {
        redirect: "/zrodla",
        reason: "unauthorized",
      },
    });
  }

  if (!newArticleUrl.value) return;
  isAdding.value = true;
  alertMessage.value = "";
  try {
    const payload = await articlePayloadFor(newArticleUrl.value);
    if (payload.name) {
      const result = await ensureArticle({ ...payload, name: payload.name });
      newArticleUrl.value = "";
      alertMessage.value = "Pomyślnie dodano artykuł.";
      console.info(`Added article: ${payload.name} (${result.nodeId})`);
      alertType.value = "success";
      await refreshArticles();
    } else {
      // Added by hand, so the title is worth insisting on: whoever pasted the
      // url is here to fix it. A source promoted out of a note has nobody
      // watching and goes in under its address instead.
      alertMessage.value = "Nie udało się pobrać tytułu artykułu.";
      alertType.value = "warning";
    }
  } catch (err) {
    console.error(err);
    alertMessage.value = "Wystąpił błąd podczas dodawania artykułu.";
    alertType.value = "error";
  } finally {
    isAdding.value = false;
  }
}

function formatDate(dateVal: string | Timestamp | undefined) {
  if (!dateVal) return "";
  if (typeof dateVal === "string") {
    return dateVal;
  }
  const dateRaw = dateVal as unknown as FirestoreTimestamp;
  const d: Date = new Date(dateRaw._seconds * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
</script>

<style scoped>
/* One colour whether the reader has opened the link before or not. The table
   is long enough that the browser's visited purple made half the titles look
   like a state this page was tracking, rather than the reader's own history.

   That colour is the body text's, not `primary`: the brand sage is around
   1.9:1 on white, which carries a chip's tint but is too light to read as a
   column of titles. Inheriting also keeps it right under a theme that changes
   the surface underneath. Every cell in Tytul is a link, so the underline is
   only wanted on hover. */
.zrodla-link,
.zrodla-link:visited {
  color: inherit;
  text-decoration: none;
}

.zrodla-link:hover,
.zrodla-link:focus-visible {
  text-decoration: underline;
}

/* A crawled title is sometimes a whole sentence. Allowed to wrap it made its
   row two or three lines tall, so a screenful of the table held a third of the
   articles it should and the columns beside it drifted out of line with their
   headers.

   The cap has to be on the column and not on the text inside it. Capping the
   text left the cell at its full width, and the slack turned into a 295px gap
   between a title and its date.

   `max-width: 0` is what makes an auto-layout table honour the percentage: on
   its own the width is a suggestion the algorithm is free to overrule, and it
   did. The two together measure 642px of title against a 16px gap, where the
   percentage alone left 295px. It has to be a real percentage - `width: 100%`
   collapses the column to 32px, because then the max-width is contradicting
   the width rather than releasing it.

   Below the breakpoint - and in the server-rendered markup, which is stacked
   until the client knows how wide it is - every cell becomes a row of its own
   and a column width means nothing: left to apply there it squeezed the title
   to 32px until hydration caught up. The marker for that is on the row rather
   than on the cell, and there is no header at all in that state. */
:deep(thead .v-data-table__th:nth-child(1)),
:deep(
  .v-data-table__tr:not(.v-data-table__tr--mobile)
    > .v-data-table__td:nth-child(1)
) {
  width: 55%;
  max-width: 0;
}

.zrodla-title-cell {
  width: 100%;
}

/* min-width:0 is the part that actually does it: a flex item defaults to
   min-width:auto, which refuses to shrink below its own text and would leave
   the ellipsis to never trigger. */
.zrodla-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
