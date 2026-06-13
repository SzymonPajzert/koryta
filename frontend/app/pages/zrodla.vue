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
        :sort-by="[{ key: 'date', order: 'desc' }]"
        mobile-breakpoint="md"
        hover
      >
        <template #[`header.date`]="{ column }">
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
          <a :href="item.sourceURL" target="_blank">{{ item.name }}</a>
        </template>
        <template #[`item.date`]="{ item }">
          {{ formatDate(item.date) }}
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

const { entities: articles, refresh: refreshArticles } = useEntities(
  "article",
  {
    limit: 100,
    page: 1,
    sortBy: "date",
    sortDesc: "true",
  },
);
const user = useCurrentUser();

const sortedArticles = computed(() => {
  return Object.values(articles.value || {})
    .map((article) => ({
      ...article,
      date: article.date || "",
    }))
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
});

const headers = [
  { title: "Tytuł", key: "name", sortable: false },
  { title: "Data publikacji", key: "date", sortable: false },
];

const newArticleUrl = ref("");
const isAdding = ref(false);
const alertMessage = ref("");
const alertType = ref<"success" | "error" | "info" | "warning">("success");

async function addArticle() {
  if (!newArticleUrl.value) return;
  isAdding.value = true;
  alertMessage.value = "";
  try {
    const metaInfo = await getPageMeta(newArticleUrl.value);
    if (metaInfo?.title) {
      const date =
        metaInfo.meta?.ldJson?.datePublished ||
        metaInfo.meta?.ldJson?.dateModified ||
        "";
      const token = await user.value?.getIdToken();
      const result = await $fetch("/api/ingest/article", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: {
          url: newArticleUrl.value,
          name: metaInfo.title,
          date: date,
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

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pl-PL");
}
</script>
