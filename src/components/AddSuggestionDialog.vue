<template>
  <AddAbstractDialog
    buttonText="Zaproponuj zmianę na stronie"
    title="Zaproponuj poprawki na stronie"
    title-icon="mdi-plus-box-outline"
    suggestionPath="suggestions/improvements"
    suggestionType="improvement"
    :initialFormData
    :toOutput
    v-model="formData"
  >
    <v-row dense>
      <v-col
        cols="12"
      >
        <v-textarea
          v-model="formData.suggestion"
          label="Sugestia"
          hint="Co możemy poprawić na stronie"
          autocomplete="off"
          required
        ></v-textarea>
      </v-col>
    </v-row>
  </AddAbstractDialog>
</template>

<script lang="ts" setup>
  import AddAbstractDialog from './AddAbstractDialog.vue';
  import { ref } from 'vue'

  const initialFormData = () => ({
    suggestion: '',
  });

  const formData = ref(initialFormData());
  const toOutput = (data: ReturnType<typeof initialFormData>) => {
    return data;
  };
</script>
