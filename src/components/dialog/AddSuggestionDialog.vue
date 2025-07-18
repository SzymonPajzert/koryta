<template>
  <v-row dense>
    <v-col cols="12">
      <v-text-field
        v-model="formData.name"
        label="Zadanie"
        hint="Krótko co trzeba zrobić"
        autocomplete="off"
        required
      ></v-text-field>
    </v-col>

    <v-col cols="12">
      <v-textarea
        v-model="formData.text"
        label="Krok po kroku, co jest do zrobienia"
        autocomplete="off"
        required
      ></v-textarea>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
  // TODO rename this file
  import type { Todo } from '@/composables/model';
  const formData = defineModel<Todo>({required: true});
</script>
