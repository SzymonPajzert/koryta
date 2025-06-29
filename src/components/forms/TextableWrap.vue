<template>
  <template v-if="props.typed == 'textField'">
    <VTextField v-model="textable.text"></VTextField>
  </template>
</template>

<script lang="ts" setup>
// TODO inherit props from the parent

import { type Textable } from '@/composables/model';
import { type Type } from '@/composables/multiTextHelper'

const props = defineProps<{typed: Type}>()
const textable = defineModel<Textable>({required: true})
</script>
