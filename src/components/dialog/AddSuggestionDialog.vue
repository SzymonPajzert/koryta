<template>
  <v-row dense>
    <v-col
      cols="12"
    >
      <v-textarea
        v-model="formData.name"
        label="Sugestia"
        hint="Co możemy poprawić na stronie"
        autocomplete="off"
        required
      ></v-textarea>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
  import type { Nameable } from '@/composables/model';
  const formData = defineModel<Nameable>({required: true});
</script>
