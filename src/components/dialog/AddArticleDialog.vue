<template>
  <v-row dense>
    <v-col
      cols="12"
    >
      <v-text-field
        v-model="formData.sourceURL"
        label="Źródło"
        hint="Link do artykułu"
        autocomplete="off"
        required
        @blur="fetchAndSetArticleTitle"
        :loading="formData.isFetchingTitle"
        :disabled="formData.isFetchingTitle"
      ></v-text-field>
    </v-col>

    <v-col cols="12">
      <v-text-field
        v-model="formData.name"
        label="Tytuł artykułu"
        autocomplete="off"
        :disabled="formData.isFetchingTitle"
      ></v-text-field>
    </v-col>

    <MultiTextField
      title="Co jest w nim ciekawego"
      v-model="formData.comments"
      field-type="textarea"
      :field-component="TextableWrap"
      :empty-value="emptyTextable"
      hint="Ciekawa informacja z artykułu, ile osób w nim jest wspomnianych"
      add-item-tooltip="Dodaj kolejne zadanie"
      remove-item-tooltip="Usuń zadanie"
    />
  </v-row>
</template>

<script lang="ts" setup>
  import { functions } from '@/firebase'
  import { httpsCallable } from 'firebase/functions';
  import type { Article } from '@/composables/model';
  import { emptyTextable } from "@/composables/multiTextHelper";
  import TextableWrap from '../forms/TextableWrap.vue';

  interface ArticleExtended extends Article {
    isFetchingTitle?: boolean;
  }

  const formData = defineModel<ArticleExtended>({required: true});
  const getPageTitle = httpsCallable(functions, 'getPageTitle');

  const fetchAndSetArticleTitle = async () => {
    if (formData.value.sourceURL && !formData.value.name) {
      formData.value.isFetchingTitle = true;
      try {
        const result = await getPageTitle({ url: formData.value.sourceURL });
        const title = (result.data as any).title;
        formData.value.name = title || '';
      } catch (error) {
        console.error("Error fetching page title:", error);
        formData.value.name = '';
      } finally {
        formData.value.isFetchingTitle = false;
      }
    }
  };
</script>
