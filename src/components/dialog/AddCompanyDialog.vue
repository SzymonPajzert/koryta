<template>
  <AddAbstractDialog
    :buttonText='editKey ? "Zapisz zmiany" : "Dodaj miejsce pracy"'
    :title='editKey ? "Edytuj osobę" : "Dodaj miejsce pracy"'
    title-icon="mdi-domain"
    suggestionPath="suggestions/company"
    adminSuggestionPath="company"
    suggestionType="company"
    :initialFormData
    :toOutput
    :editKey="editKey"
    v-model="formData"
    :maxWidth="800"
    :dialog-type="{ entity: 'company' }"
    :store-id
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
          :label="`Nazwa`"
          hint="Firma, organizacja, ministerstwo"
          autocomplete="off"
          required
        ></v-text-field>
      </v-col>

      <v-col
        cols="12"
      >
        <EntityPicker
          v-model="formData.owner"
          entity="company"
          label="Właściciel"
          hint="Jednostka do której należy dodawana firma"
        ></EntityPicker>
      </v-col>

      <v-col
        cols="12"
      >
        <EntityPicker
          v-model="formData.manager"
          entity="employed"
          label="Zarządca"
          hint="Osoba, która zarządza firmą"
        ></EntityPicker>
      </v-col>
    </v-row>
  </AddAbstractDialog>
</template>

<script lang="ts" setup>
  import AddAbstractDialog from './AddAbstractDialog.vue';
  import { type Company } from '@/composables/company'
  import { ref } from 'vue'

  const { initial, editKey } = defineProps<{
    initial?: Company,  // if defined, sets the value of the form
    editKey?: string    // if provided, modifies the entry rather than submitting a new one
    storeId: number;
  }>();

  const initialFormData = () => {
    if (initial) {
      return {
        name: initial.name,
        owner: initial.owner,
        manager: initial.manager,
      };
    }

    return {
      name: '',
    }
  };

  const formData = ref(initialFormData());
  const toOutput = (data: ReturnType<typeof initialFormData>) => {
    return data;
  };
</script>
