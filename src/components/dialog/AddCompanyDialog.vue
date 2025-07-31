<template>
  <v-row dense>
    <v-col cols="12" md="12">
      <AlreadyExisting
        v-model="formData.name"
        entity="company"
        label="Nazwa"
        hint="Firma, organizacja, ministerstwo"
        autocomplete="off"
        :create="create"
        required
      />
    </v-col>

    <v-col cols="12">
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
    </v-col>

    <v-col cols="12" md="6">
      <v-text-field
        label="Numer KRS"
        :rules="[
          (value) =>
            prependZeros(value) != value ? 'Dodaj zera na początku' : true,
          (value) => (prependZeros(value).length != 10 ? '10 cyfr' : true),
        ]"
        :v-model="formData.krsNumber"
      />
    </v-col>
    <v-col cols="12" md="6">
      <v-text-field label="Numer NIP" :v-model="formData.nipNumber" />
    </v-col>

    <v-col cols="12">
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
    </v-col>

    <BacklinksList :id="id" :todo-consumer="addCreatedTodo" />
  </v-row>
</template>

<script lang="ts" setup>
import { Link, type Company } from "@/composables/model";
import {
  emptyEntityPicker,
  emptyTextable,
} from "@/composables/multiTextHelper";
import EntityPicker from "../forms/EntityPicker.vue";
import TextableWrap from "../forms/TextableWrap.vue";
import type { Callback } from "@/stores/dialog";

const formData = defineModel<Company>({ required: true });
const { create } = defineProps<{ id?: string; create?: boolean }>();

function prependZeros(value: string) {
  return value.padStart(10, "0");
}

const addCreatedTodo: Callback = (name, key) => {
  if (!key) {
    console.warn("failed to obtain key for new entity: ", name);
    // TODO log on the server all console.warns and higher
    return;
  }
  formData.value.todos[key] = new Link<"todo">("todo", key, name);
};
</script>
