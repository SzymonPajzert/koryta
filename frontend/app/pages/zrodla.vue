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
        hover
      >
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
import { useEntities } from "~/composables/entity";
import { getPageMeta } from "~/composables/useFunctions";
import { authFetch } from "~/composables/auth";

const { entities: articles } = useEntities("article");

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
  { title: "Tytuł", key: "name", sortable: true },
  { title: "Data publikacji", key: "date", sortable: true },
];

const newArticleUrl = ref("");
const isAdding = ref(false);

async function addArticle() {
  if (!newArticleUrl.value) return;
  isAdding.value = true;
  try {
    const metaInfo = await getPageMeta(newArticleUrl.value);
    if (metaInfo?.title) {
      const date =
        metaInfo.meta?.ldJson?.datePublished ||
        metaInfo.meta?.ldJson?.dateModified ||
        "";
      await authFetch("/api/ingest/article", {
        method: "POST",
        body: {
          url: newArticleUrl.value,
          name: metaInfo.title,
          date: date,
        },
      });
      newArticleUrl.value = "";
    } else {
      alert("Nie udało się pobrać tytułu artykułu.");
    }
  } catch (err) {
    console.error(err);
    alert("Wystąpił błąd podczas dodawania artykułu.");
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
