<template>
  <v-row cols="12">
    <v-col cols="12">
      <v-card>
        <v-card-text>
          Niniejsza strona została utworzona na podstawie materiałów prasowych,
          informacji zawartych w Krajowym Rejestrze Sądowym, a także w oparciu o
          inne ogólnodostępne źródła. Strona wskazuje wybrane powiązania o
          charakterze biznesowym, rodzinnym lub innym łączące niektóre osoby
          zatrudnione w spółkach, fundacjach i organizacjach zarządzanych przez
          organy polskiego państwa. Powiązanie, które zdołaliśmy ustalić i które
          w naszej opinii są istotne dla całościowego spojrzenia na proces
          wybierania ludzi na stanowiska poza konkursami. Zastrzegamy, że celem
          strony nie jest twierdzenie, że wszystkie osoby uwidocznione na mapie
          działają wspólnie lub w porozumieniu, jak również przesądzanie o
          czyjejkolwiek osobistej winie lub odpowiedzialności prawnej.
        </v-card-text>
      </v-card>
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
      </v-card>
    </v-col>

    <v-col cols="12">
      <h3 class="text-h6 font-weight-bold mb-4">
        Źródła tej strony to między innymi:
      </h3>
      <v-data-table
        :headers="headers"
        :items="sortedArticles"
        :items-per-page="50"
        :sort-by="[{ key: 'publishedDate', order: 'desc' }]"
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
          <div class="d-flex align-center">
            <v-avatar
              v-if="item.sourceURL"
              :image="getDomainIcon(item.sourceURL)"
              size="x-small"
              class="mr-2"
            />
            <a :href="item.sourceURL" target="_blank">{{ item.name }}</a>
          </div>
        </template>
        <template #[`item.publishedDate`]="{ item }">
          {{ formatDate(item.publishedDate) }}
        </template>
      </v-data-table>
    </v-col>

    <v-col cols="12">
      <a href="https://www.flaticon.com/free-icons/pork" title="pork icons">
        Pork icons created by Freepik - Flaticon
      </a>
      <a href="https://www.flaticon.com/free-icon/pig_3800575"> - link</a>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { mdiArrowDown } from "@mdi/js";
import { useEntities } from "~/composables/entity";
import { getPageMeta } from "~/composables/useFunctions";
import { useCurrentUser } from "vuefire";
import type { Timestamp } from "firebase-admin/firestore";
import { useDomainIcon } from "~/composables/useDomainIcon";

definePageMeta({
  title: "Źródła",
  affineLink: "BBMIZtWOoDBTDknqC82Ms",
});

const { entities: articles, refresh: refreshArticles } = useEntities(
  "article",
  {
    limit: 100,
    page: 1,
    sortBy: "publishedDate",
    sortDesc: "true",
  },
);
const user = useCurrentUser();
const { getDomainIcon } = useDomainIcon();

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

const headers = [
  { title: "Tytuł", key: "name", sortable: false },
  { title: "Data publikacji", key: "publishedDate", sortable: false },
];

const newArticleUrl = ref("");
const isAdding = ref(false);
const alertMessage = ref("");
const alertType = ref<"success" | "error" | "info" | "warning">("success");

type nestedRecord = {
  [key: string]: string | nestedRecord;
};

function deepSearch(
  obj: nestedRecord | string | undefined | null,
  key: string,
): string | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;

  const val = obj[key];
  if (typeof val === "string") {
    return val;
  }

  for (const k in obj) {
    const result = deepSearch(obj[k], key);
    if (result !== undefined) {
      return result;
    }
  }

  return undefined;
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
    const metaInfo = await getPageMeta(newArticleUrl.value);
    if (metaInfo?.title) {
      // TODO this should be moved to somewhere else - logic heavy
      const publishedDate =
        metaInfo.meta?.ldJson?.datePublished ||
        metaInfo.meta?.ldJson?.dateModified ||
        deepSearch(metaInfo.meta, "datePublished") ||
        deepSearch(metaInfo.meta, "dateModified");
      const token = await user.value.getIdToken();
      const result = await $fetch("/api/ingest/article", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: {
          url: metaInfo.url || newArticleUrl.value,
          name: metaInfo.title,
          publishedDate,
          meta: metaInfo.meta,
        },
      });
      newArticleUrl.value = "";
      alertMessage.value = "Pomyślnie dodano artykuł.";
      console.info(`Added article: ${metaInfo.title} (${result.nodeId})`);
      alertType.value = "success";
      await refreshArticles();
    } else {
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
