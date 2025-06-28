<template>
  <AddAbstractDialog
    :buttonText='editKey ? "Zapisz zmiany" : "Dodaj nową osobę"'
    :title='editKey ? "Edytuj osobę" : "Dodaj nową osobę"'
    title-icon="mdi-account-plus-outline"
    suggestionPath="suggestions/employed"
    adminSuggestionPath="employed"
    suggestionType="employed"
    :initialFormData
    :toOutput
    :editKey="editKey"
    v-model="formData"
    :maxWidth="800"
    :dialog-type="{ entity: 'employed' }"
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
        :field-type=NestedConnectionField
        entity="company"
        hint="np. Członek rady nadzorczej XYZ sp. z o.o."
        add-item-tooltip="Dodaj kolejne zatrudnienie"
        remove-item-tooltip="Usuń zatrudnienie"
        :empty-value="() => ({ text: '' })"
      />
      <MultiTextField
        title="Koneksja"
        v-model="formData.connections"
        :field-type=NestedConnectionField
        entity="employed"
        hint="np. Znajomy ministra"
        add-item-tooltip="Dodaj kolejną koneksję"
        remove-item-tooltip="Usuń koneksję"
        :empty-value="() => ({ text: '' })"
      />
      <MultiTextField
        title="Inna uwaga"
        v-model="formData.comments"
        :field-type=VTextarea
        hint="Dodatkowe informacje, np. okoliczności nominacji, wysokość wynagrodzenia"
        add-item-tooltip="Dodaj kolejną uwagę"
        remove-item-tooltip="Usuń uwagę"
        :empty-value="() => ''"
      />
    </v-row>
  </AddAbstractDialog>
</template>

<script lang="ts" setup>
  import AddAbstractDialog from './AddAbstractDialog.vue';
  import { useFeminatyw } from '@/composables/feminatyw';
  import { usePartyStatistics, type NepoEmployment } from '@/composables/party';
  import { type Textable, useSuggestDB } from '@/composables/suggestDB'
  import { VTextarea, VTextField } from 'vuetify/components';
  import { computed, ref } from 'vue'
  import MultiTextField from '@/components/forms/MultiTextField.vue';
  import NestedConnectionField from '@/components/forms/NestedConnectionField.vue';

  const { initial, editKey } = defineProps<{
    initial?: NepoEmployment,  // if defined, sets the value of the form
    editKey?: string           // if provided, modifies the entry rather than submitting a new one
  }>();

  const { parties } = usePartyStatistics();
  const { arrayToKeysMap } = useSuggestDB();

  const partiesDefault = computed<string[]>(() => [...parties.value, 'inne'])
  const { koryciarz } = useFeminatyw();

  const initialFormData = () => {
    if (initial) {
      return {
        name: initial.name,
        parties: initial.parties,
        employments: Object.values(initial.employments || {}) as Textable[],
        connections: Object.values(initial.connections || {}) as Textable[],
        source: initial.sourceURL,
        comments: Object.values(initial.comments || {}).map(s => s.text) as string[],
      };
    }

    return {
      name: '',
      parties: [] as string[],
      employments: [{ text: '' }] as Textable[],
      connections: [{ text: '' }] as Textable[],
      source: '',
      comments: [''] as string[],
    }
  };

  const formData = ref(initialFormData());

  const toOutput = (data: ReturnType<typeof initialFormData>) => {
    return {
      name: data.name,
      parties: data.parties,
      employments: arrayToKeysMap(data.employments),
      connections: arrayToKeysMap(data.connections),
      sourceURL: data.source,
      comments: arrayToKeysMap(data.comments.map(s => ({ text: s }))),
    };
  };
</script>
