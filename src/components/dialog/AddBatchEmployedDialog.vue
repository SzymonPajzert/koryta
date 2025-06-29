<template>
  <AddAbstractDialog
    buttonText="Wiele osób z CSV"
    title="Masowe dodawanie zatrudnionych (CSV)"
    title-icon="mdi-file-upload-outline"
    suggestionPath="suggestions/employed"
    adminSuggestionPath="employed"
    suggestionType="employed"
    :initialFormData
    :toOutput
    v-model="formData"
    :dialog-type="{ entity: 'employed', format: 'batch' }"
    :store-id
  >
    <v-row dense>
      <v-col cols="12">
        <v-card>
          <v-card-text variant="flat">
            Wypełnij plik CSV w <a href="https://docs.google.com/spreadsheets/d/1nGxM_rqPHLp_VyvQTVgLmfHZJFxifIJeVyOAxS9iI8c" target="_blank">tym formacie</a> i prześlij go do nas.

            Zobacz <a href="https://youtu.be/FEq3f0eQ-9A" target="_blank">krótki poradnik</a>  i napisz pod nim, jeśli coś Ci nie działa.
          </v-card-text>
        </v-card>
      </v-col>
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
import { type NepoEmployment } from '@/composables/party';
import Papa from 'papaparse';

const { storeId } = defineProps<{
  storeId: number;
}>();

interface CsvRow {
  employed: string;
  connection: string;
  name: string;
  party: string;
  source: string;
  comment: string;
}

const initialFormData = () => ({
  file: null as File | null,
});

const formData = ref(initialFormData());

const { arrayToKeysMap, newKey } = useSuggestDB();

const toOutput = async (data: {
  file: File | null;
}): Promise<any> => {
  if (!data.file) {
    return null;
  }

  try {
    return new Promise((resolve, reject) => {
      if (!data.file) {
        resolve(null);
        return;
      }
      Papa.parse<CsvRow>(data.file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: header => header.trim().toLowerCase(),
        complete: (results) => {
          const expectedHeaders = ['employed', 'connection', 'name', 'party', 'source', 'comment'];
          const actualHeaders = results.meta.fields;

          if (!actualHeaders) {
            console.error('CSV file is missing headers.');
            // Idealnie, pokaż ten błąd użytkownikowi przez dialog
            reject(new Error('CSV file is missing headers.'));
            return;
          }

          for (const eh of expectedHeaders) {
            if (!actualHeaders.includes(eh)) {
              console.error(`CSV file is missing required header: ${eh}. Expected headers are: ${expectedHeaders.join(', ')}.`);
              // Idealnie, pokaż ten błąd użytkownikowi
              reject(new Error(`CSV file is missing required header: ${eh}.`));
              return;
            }
          }

          const outputData: NepoEmployment[] = []
          results.data.forEach(row => {
            if (row.name == '') {
              // Append the data to the previous row
              const prev = outputData[outputData.length - 1];
              if (row.party) {
                if (!prev.parties) prev.parties = [];
                prev.parties.push(row.party);
              }
              if (row.employed) {
                if (!prev.employments) prev.employments = {};
                prev.employments[newKey()] = { text: row.employed, relation: '' };
              }
              if (row.connection) {
                if (!prev.connections) prev.connections = {};
                prev.connections[newKey()] = { text: row.connection, relation: '' };
              }
              if (row.comment) {
                if (!prev.comments) prev.comments = {};
                prev.comments[newKey()] = { text: row.comment };
              }
              if (row.source) {
                if (!prev.sources) prev.sources = {};
                prev.sources[newKey()] = { text: row.source };
              }
              return
            }

            outputData.push({
              name: row.name,
              parties: row.party ? [row.party] : [],
              employments: arrayToKeysMap(row.employed ? [{ text: row.employed }] : []),
              connections: arrayToKeysMap(row.connection ? [{ text: row.connection }] : []),
              // TODO do they work?
              // TODO am I happy with sources as hash map? I guess so
              sources: arrayToKeysMap(row.source ? [{ text: row.source }] : []),
              comments: arrayToKeysMap(row.comment ? [{ text: row.comment }] : []),
              sourceURL: row.source || '',
            } as NepoEmployment)
          });

          resolve(outputData);
        },
        error: (error: any) => {
          console.error('Error parsing CSV file:', error);
          // TODO Idealnie, pokaż ten błąd użytkownikowi
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error('Error processing CSV file:', error);
    // TODO Ideally, show this error to the user
    return null;
  }
};
</script>
