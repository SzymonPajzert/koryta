<template>
  <v-expansion-panels width="100%" class="w-100">
    <v-expansion-panel v-if="modelValue">
      <v-expansion-panel-title>
        <p class="text-no-wrap" v-if="title">
          {{ title }}
        </p>
        <p class="text-no-wrap font-italic" v-else>
          {{ props.hint }}
        </p>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <v-row>
          <v-col cols="12" sm="6">
            <VTextField
              :label="relationLabel"
              :hint="relationHint"
              class="mt-2"
              v-model="modelValue.relation"
              autocomplete="off"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <EntityPicker
              v-model="modelValue.connection"
              :entity="entity"
              :label="connectedLabel"
              :hint="connectedHint"
            />
          </v-col>
        </v-row>

        <VTextarea
          v-bind="props"
          v-model="modelValue.text"
          auto-grow
          rows="3"
        />
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<script lang="ts" setup generic="D extends Destination">
import { VTextField, VTextarea } from "vuetify/components";
import type { Destination, Connection } from "~~/shared/model";

// Define props for the component, specifically for v-model support.
// All other props passed to NestedConnectionField will automatically be bound to VTextField via $attrs.
const props = defineProps<{
  hint: string;
  entity: D;
}>();
const modelValue = defineModel<Connection<D>>();

const title = computed(() => {
  if (!modelValue.value) return undefined;
  const v = modelValue.value;
  if (v.relation && v.connection)
    return `${v.relation} - ${v.connection?.text}`;
  if (v.relation) return v.relation;
  if (v.text) return v.text;
  return undefined;
});



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
</script>

<style scoped>
.v-container {
  padding: 0px;
}
</style>
