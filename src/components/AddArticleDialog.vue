<template>
  <AddAbstractDialog
    buttonText="Dodaj artykuł / źródło"
    title="Dodaj nowy artykuł"
    title-icon="mdi-file-document-outline"
    suggestionPath="suggestions/data"
    adminSuggestionPath="data"
    suggestionType="data"
    :initialFormData
    :toOutput
    v-model="formData"
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
        ></v-text-field>
      </v-col>

      <MultiTextField
        title="Co jest w nim ciekawego"
        v-model="formData.comments"
        hint="Ciekawa informacja z artykułu, ile osób w nim jest wspomnianych"
        add-item-tooltip="Dodaj kolejne zadanie"
        remove-item-tooltip="Usuń zadanie"
      />
    </v-row>
  </AddAbstractDialog>
</template>

<script lang="ts" setup>
  import AddAbstractDialog from './AddAbstractDialog.vue';
  import { type Textable, useSuggestDB } from '@/composables/suggestDB'

  import { ref } from 'vue'
  import MultiTextField from './MultiTextField.vue';

  const { arrayToKeysMap } = useSuggestDB();

  const initialFormData = () => ({
    source: '',
    comments: [{ text: '' }] as Textable[],
  });

  const formData = ref(initialFormData());

  const toOutput = (data: ReturnType<typeof initialFormData>) => {
    return {
      sourceURL: data.source,
      comments: arrayToKeysMap(data.comments),
    };
  };
</script>
