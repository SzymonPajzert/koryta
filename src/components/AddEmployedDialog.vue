<template>
  <AddAbstractDialog
    buttonText="Dodaj nową osobę"
    title="Dodaj nową osobę"
    title-icon="mdi-account-plus-outline"
    suggestionPath="suggestions/employed"
    adminSuggestionPath="employed"
    suggestionType="employed"
    :initialFormData
    :toOutput
    v-model="formData"
  >
    <template #button="activatorProps">
      <slot name="button" v-bind="activatorProps"></slot>
    </template>
    <v-row dense>
      <v-col
        cols="12"
        md="12"
      >
        <v-text-field
          v-model="formData.name"
          :label="`Imię i nazwisko ${koryciarz.singular.accusative}`"
          hint="Osoba zatrudniona w publicznej firmie"
          autocomplete="off"
          required
        ></v-text-field>
      </v-col>

      <v-col
        cols="12"
        md="8"
        sm="12"
      >
        <v-text-field
          v-model="formData.source"
          label="Źródło"
          hint="Link do artykułu"
          autocomplete="off"
          required
        ></v-text-field>
      </v-col>

      <v-col
        cols="12"
        md="4"
        sm="6"
      >
        <v-select
          v-model="formData.parties"
          :items="partiesDefault"
          label="Partia"
          multiple
          chips
          deletable-chips
          required
        ></v-select>
      </v-col>

      <!-- Dynamic fields for Employments -->
      <MultiTextField
        title="Zatrudnienie"
        v-model="formData.employments"
        hint="np. Członek rady nadzorczej XYZ sp. z o.o."
        add-item-tooltip="Dodaj kolejne zatrudnienie"
        remove-item-tooltip="Usuń zatrudnienie"
      />
      <MultiTextField
        title="Koneksja"
        v-model="formData.connections"
        hint="np. Znajomy ministra"
        add-item-tooltip="Dodaj kolejną koneksję"
        remove-item-tooltip="Usuń koneksję"
      />
      <MultiTextField
        title="Inna uwaga"
        v-model="formData.comments"
        field-type="textarea"
        hint="Dodatkowe informacje, np. okoliczności nominacji, wysokość wynagrodzenia"
        add-item-tooltip="Dodaj kolejną uwagę"
        remove-item-tooltip="Usuń uwagę"
      />
    </v-row>
  </AddAbstractDialog>
</template>

<script lang="ts" setup>
  import AddAbstractDialog from './AddAbstractDialog.vue';
  import { useFeminatyw } from '@/composables/feminatyw';
  import { usePartyStatistics } from '@/composables/party';
  import { type Textable, useSuggestDB } from '@/composables/suggestDB'

  import { computed, ref } from 'vue'
  import MultiTextField from './MultiTextField.vue';

  const { parties } = usePartyStatistics();
  const { arrayToKeysMap } = useSuggestDB();

  const partiesDefault = computed<string[]>(() => [...parties.value, 'inne'])
  const { koryciarz } = useFeminatyw();

  const initialFormData = () => ({
    name: '',
    parties: [] as string[],
    employments: [{ text: '' }] as Textable[],
    connections: [{ text: '' }] as Textable[],
    source: '',
    comments: [{ text: '' }] as Textable[],
  });

  const formData = ref(initialFormData());

  const toOutput = (data: ReturnType<typeof initialFormData>) => {
    return {
      name: data.name,
      parties: data.parties,
      employments: arrayToKeysMap(data.employments),
      connections: arrayToKeysMap(data.connections),
      sourceURL: data.source,
      comments: arrayToKeysMap(data.comments),
    };
  };
</script>
