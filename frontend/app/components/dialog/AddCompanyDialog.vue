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
        v-slot="itemProps"
        title="Właściciele"
        edge-type="owns"
        :edge-reverse="true"
        :source-id="id"
      >
        <EntityPicker
          v-model="itemProps.value"
          entity="company"
          hint="np. grupa kapitałowa, ministerstwo"
        />
      </MultiTextField>
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

    <MultiTextField
      v-slot="itemProps"
      title="Inna uwaga"
      edge-type="comment"
      :source-id="id"
    >
      <VTextarea
        v-model="itemProps.value.text"
        auto-grow
        rows="2"
        hint="Dodatkowe informacje, np. okoliczności nominacji, wysokość wynagrodzenia"
      />
    </MultiTextField>

    <!-- TODO Reenable <BacklinksList :id="id" /> -->
  </v-row>
</template>

<script lang="ts" setup>
import type { Company } from "~~/shared/model";
import EntityPicker from "../forms/EntityPicker.vue";

const formData = defineModel<Company>({ required: true });
const { create } = defineProps<{ id: string | undefined; create?: boolean }>();

function prependZeros(value: string) {
  return value.padStart(10, "0");
}
</script>
