<template>
  <v-autocomplete
    :key="model?.id"
    v-model="model"
    v-model:search="search"
    :label="props.label"
    :hint="props.hint"
    :items="entitiesList"
    item-title="text"
    item-value="id"
    required
    return-object
    autocomplete="off"
  >
    <template #no-data>
      <v-list-item v-if="search" @click="addNewItem">
        <v-list-item-title>
          Add "<strong>{{ search }}</strong>" as a new {{ props.entity }}.
        </v-list-item-title>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useDialogStore } from '@/stores/dialog'; // Import the new store
import { useListEntity } from '@/composables/entity';
import { type Destination, Link } from '@/composables/model'

const props = defineProps<{
  label: string;
  hint: string;
  // which entity type to use to lookup suggested values to bind to this field
  // e.g. employed, company
  entity: Destination;
}>()

const dialogStore = useDialogStore();

const model = defineModel<Link<typeof props.entity>>();

const search = ref('');

const { entities } = useListEntity(props.entity)

const entitiesList = computed(() => Object.entries(entities.value ?? {}).map(([key, value]) => {
  return new Link<typeof props.entity>(props.entity, key, value.name)
}))

function addNewItem() {
  const newEntityName = search.value;
  if (newEntityName) {
    // Clear the search input after triggering the add new item action
    // This prevents the "Add new..." option from reappearing immediately
    // if the dialog is closed without selecting the newly created item.
    search.value = '';
    dialogStore.open({
      name: newEntityName,
      type: props.entity,
      defaultValue: () => ({name: newEntityName}),
     });
  }
}
</script>
