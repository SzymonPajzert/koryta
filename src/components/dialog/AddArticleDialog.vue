<template>
  <AddAbstractDialog
    buttonText="Dodaj artykuł / źródło"
    title="Dodaj nowy artykuł"
    title-icon="mdi-file-document-plus-outline"
    suggestionPath="suggestions/data"
    adminSuggestionPath="data"
    suggestionType="data"
    :initialFormData
    :toOutput
    v-model="formData"
    :dialog-type="{ entity: 'data' }"
    :store-id
  >
    <v-row dense>
      <v-col
        cols="12"
      >
        <v-text-field
          v-model="formData.source"
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
          v-model="formData.title"
          label="Tytuł artykułu"
          autocomplete="off"
          :disabled="formData.isFetchingTitle"
        ></v-text-field>
      </v-col>

      <MultiTextField
        title="Co jest w nim ciekawego"
        v-model="formData.comments"
        hint="Ciekawa informacja z artykułu, ile osób w nim jest wspomnianych"
        add-item-tooltip="Dodaj kolejne zadanie"
        remove-item-tooltip="Usuń zadanie"
        :empty-value="() => ''"
      />
    </v-row>
  </AddAbstractDialog>
</template>

<script lang="ts" setup>
  import AddAbstractDialog from './AddAbstractDialog.vue';
  import { type Textable, useSuggestDB } from '@/composables/suggestDB';
  import { functions } from '@/firebase'
  import { httpsCallable } from 'firebase/functions';

  import { ref } from 'vue'

  const { storeId } = defineProps<{
    storeId: number;
  }>();

  const { arrayToKeysMap } = useSuggestDB();
  const getPageTitle = httpsCallable(functions, 'getPageTitle');

  const initialFormData = () => ({
    source: '',
    title: '',
    comments: [''] as string[],
    isFetchingTitle: false,
  });

  const formData = ref(initialFormData());

  const fetchAndSetArticleTitle = async () => {
    if (formData.value.source && !formData.value.title) {
      formData.value.isFetchingTitle = true;
      try {
        const result = await getPageTitle({ url: formData.value.source });
        const title = (result.data as any).title;
        formData.value.title = title || '';
      } catch (error) {
        console.error("Error fetching page title:", error);
        formData.value.title = '';
      } finally {
        formData.value.isFetchingTitle = false;
      }
    }
  };

  const toOutput = (data: ReturnType<typeof initialFormData>) => {
    return {
      sourceURL: data.source,
      title: data.title,
      comments: arrayToKeysMap(data.comments.map(s => ({text: s}))),
    };
  };
</script>
