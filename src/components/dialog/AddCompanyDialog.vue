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

    <MultiTextField
      title="Właściciele"
      v-model="formData.owners"
      field-type="entityPicker"
      :field-component="EntityPicker"
      entity="company"
      hint="np. grupa kapitałowa, ministerstwo"
      add-item-tooltip="Dodaj kolejne miejsce"
      remove-item-tooltip="Usuń miejsce"
      :empty-value="() => emptyEntityPicker('company')"
    />

    <v-col cols="12">
      <EntityPicker
        v-model="formData.manager"
        entity="employed"
        label="Zarządca"
        hint="Osoba, która zarządza firmą"
      ></EntityPicker>
    </v-col>

    <MultiTextField
      title="Inna uwaga"
      v-model="formData.comments"
      field-type="textarea"
      :field-component="TextableWrap"
      hint="Dodatkowe informacje, np. okoliczności nominacji, wysokość wynagrodzenia"
      add-item-tooltip="Dodaj kolejną uwagę"
      remove-item-tooltip="Usuń uwagę"
      :empty-value="emptyTextable"
    />
  </v-row>
</template>

<script lang="ts" setup>
import { type Company } from "@/composables/model";
import { emptyEntityPicker, emptyTextable } from "@/composables/multiTextHelper";
import EntityPicker from '../forms/EntityPicker.vue';
import TextableWrap from '../forms/TextableWrap.vue';

const formData = defineModel<Company>({required: true});
</script>
