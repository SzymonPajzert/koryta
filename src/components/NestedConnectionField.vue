<template>
  <!-- Main VTextField component -->
  <v-col cols="12" v-if="modelValue">
    <VTextField
      v-bind="$attrs"
      v-model="modelValue.text"
      @click="toggleNestedFields"
    >
      <template v-slot:prepend>
        <slot name="prepend" />
      </template>
    </VTextField>
  </v-col>

  <!-- Nested fields that appear/disappear with a transition -->
  <VExpandTransition v-if="modelValue">
    <v-col cols="12" md="6" v-if="showNestedFields">
      <VTextField
        :label="relationLabel"
        :hint="relationHint"
        class="mt-2"
        v-model="modelValue.relation"
      />
    </v-col>
  </VExpandTransition>
  <VExpandTransition v-if="modelValue">
    <v-col cols="12" md="6" v-if="showNestedFields">
      <EntityPicker
        v-model="modelValue.connection"
        :entity="entity"
        :label="connectedLabel"
        :hint="connectedHint"
      ></EntityPicker>
    </v-col>
  </VExpandTransition>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { VTextField, VExpandTransition } from "vuetify/components";
import { Link, type Destination, type Connection } from "@/composables/entity";

// Define props for the component, specifically for v-model support.
// All other props passed to NestedConnectionField will automatically be bound to VTextField via $attrs.
const modelValue = defineModel<Connection>();

const props = defineProps<{
  entity: Destination;
}>();

const relationLabel = props.entity === "company" ? "Stanowisko" : "Relacja";
const relationHint =
  props.entity === "company"
    ? "Krótko, np. prezes, dyrektor, ministra"
    : "Krótko, np. córka, sąsiad, kolega, itd.";
const connectedLabel = props.entity === "company" ? "Firma" : "Znajomy/a";
const connectedHint =
  props.entity === "company"
    ? "Miejsce zatrudnienia"
    : "Wyżej postawiona, znana osoba";

const showNestedFields = ref(false);
// Toggles the visibility of the nested fields.
const toggleNestedFields = () => {
  showNestedFields.value = !showNestedFields.value;
};
</script>
