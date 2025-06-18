<template>
  <AddAbstractDialog
    buttonText="Wgraj plik CSV"
    title="Masowe dodawanie zatrudnionych (CSV)"
    title-icon="mdi-file-upload-outline"
    suggestionPath="suggestions/employed"
    adminSuggestionPath="employed"
    suggestionType="employed"
    :initialFormData
    :toOutput
    v-model="formData"
  >
    <v-row dense>
      <v-col cols="12">
        <v-file-input
          v-model="formData.file"
          label="Plik CSV"
          hint="Wybierz plik CSV. Kolumny: employed, connection, name, party. Pierwszy wiersz jako nagłówek."
          accept=".csv"
          prepend-icon="mdi-paperclip"
          required
        ></v-file-input>
      </v-col>
    </v-row>
  </AddAbstractDialog>
</template>

<script lang="ts" setup>
import { useSuggestDB } from '@/composables/suggestDB'
import AddAbstractDialog from './AddAbstractDialog.vue';
import { ref } from 'vue';

interface EmployedRecord {
  employed: string;
  connection: string;
  name: string;
  party: string;
}

const initialFormData = () => ({
  file: null as File | null,
});

const formData = ref(initialFormData());

const { arrayToKeysMap } = useSuggestDB();

const toOutput = async (data: {
  file: File | null;
}): Promise<any> => {
  if (!data.file) {
    return null;
  }

  try {
    const text = await data.file.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');

    if (lines.length < 2) {
      console.error('CSV file must contain a header row and at least one data row.');
      // Ideally, show this error to the user via the dialog
      return null;
    }

    const headerLine = lines[0];
    const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
    const expectedHeaders = ['employed', 'connection', 'name', 'party', 'source'];
    const headerMap: Record<string, number> = {};

    for (const eh of expectedHeaders) {
      const index = headers.indexOf(eh);
      if (index === -1) {
        console.error(`CSV file is missing required header: ${eh}. Expected headers are: ${expectedHeaders.join(', ')}.`);
        return null;
      }
      headerMap[eh] = index;
    }

    return lines.slice(1).map((line) => {
      const values = line.split(',').map((v) => v.trim());
      return {
        name: values[headerMap.name] || '',
        parties: [values[headerMap.party]],
        employments: arrayToKeysMap([{ text: values[headerMap.employed] }]),
        connections: arrayToKeysMap([{ text: values[headerMap.connection] }]),
        sourceURL: values[headerMap.source] || '',
      };
    });
  } catch (error) {
    console.error('Error processing CSV file:', error);
    // Ideally, show this error to the user
    return null;
  }
};
</script>
