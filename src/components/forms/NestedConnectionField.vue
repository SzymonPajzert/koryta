<template>
  <!-- Main VTextField component -->
  <v-col cols="12" md="8" v-if="modelValue">
    <VTextarea
      v-bind="$attrs"
      v-model="modelValue.text"
      @click="toggleNestedFields"
      auto-grow
      rows="3"
    >
      <template v-slot:prepend>
        <slot name="prepend" />
      </template>
    </VTextarea>
  </v-col>

  <!-- Nested fields that appear/disappear with a transition -->
  <v-col cols="12" md="4" v-if="modelValue">
    <v-container ma-0 pa-0>
      <VTextField
        :label="relationLabel"
        :hint="relationHint"
        class="mt-2"
        v-model="modelValue.relation"
        autocomplete="off"
      />
      <EntityPicker
        v-model="modelValue.connection"
        :entity="entity"
        :label="connectedLabel"
        :hint="connectedHint"
      ></EntityPicker>
    </v-container>
  </v-col>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { VTextField, VExpandTransition, VTextarea } from "vuetify/components";
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

<style scoped>
.v-container {
  padding: 0px
}
</style>
