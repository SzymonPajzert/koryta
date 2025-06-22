<template>
  <v-autocomplete
    v-model="model"
    :label="props.label"
    :hint="props.hint"
    :items="entitiesList"
    item-title="text"
    item-value="id"
    required
  ></v-autocomplete>
</template>

<script setup lang="ts">
import { useListEntity, type Destination } from '@/composables/entity';

const props = defineProps<{
  label: string;
  hint: string;
  // which entity type to use to lookup suggested values to bind to this field
  // e.g. employed, company
  entity: Destination;
}>()

const model = defineModel<string>();

const { entities } = useListEntity(props.entity)

const entitiesList = computed(() => Object.entries(entities.value ?? {}).map(([key, value]) => {
  return {
    text: value.name,
    id: key
  }
}))
</script>
