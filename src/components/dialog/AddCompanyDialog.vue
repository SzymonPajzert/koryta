<template>
  <v-row dense>
    <v-col cols="12" md="12">
      <v-text-field
        v-model="formData.name"
        :label="`Nazwa`"
        hint="Firma, organizacja, ministerstwo"
        autocomplete="off"
        required
      ></v-text-field>
    </v-col>

    <v-col cols="12">
      <EntityPicker
        v-model="formData.owner"
        entity="company"
        label="Właściciel"
        hint="Jednostka do której należy dodawana firma"
      ></EntityPicker>
    </v-col>

    <v-col cols="12">
      <EntityPicker
        v-model="formData.manager"
        entity="employed"
        label="Zarządca"
        hint="Osoba, która zarządza firmą"
      ></EntityPicker>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
import { type Company } from "@/composables/model";
const formData = defineModel<Company>({required: true});
</script>
