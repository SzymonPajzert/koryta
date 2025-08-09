<template>
  <template v-if="props.fieldType == 'textField'">
    <VTextField v-model="textable.text" v-bind="$attrs">
      <template #prepend>
        <slot name="prepend"></slot>
      </template>
    </VTextField>
  </template>
  <template v-if="props.fieldType == 'textarea'">
    <VTextarea v-model="textable.text" v-bind="$attrs">
      <template #prepend>
        <slot name="prepend"></slot>
      </template>
    </VTextarea>
  </template>
</template>

<script lang="ts" setup>
// TODO inherit props from the parent

import type { Textable } from "~~/shared/model";
import type { Type } from "@/composables/multiTextHelper";

const props = defineProps<{
  fieldType: Type;
}>();
const textable = defineModel<Textable>({ required: true });
</script>
