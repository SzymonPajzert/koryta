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
          Dodaj "<strong>{{ search }}</strong
          >" do bazy.
        </v-list-item-title>
      </v-list-item>
    </template>
    <template #prepend>
      <slot name="prepend"></slot>
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useDialogStore } from "@/stores/dialog"; // Import the new store
import { createEntityStore } from "@/stores/entity";
import { type Destination, Link } from "@/composables/model";

const props = defineProps<{
  label: string;
  hint?: string;
  // which entity type to use to lookup suggested values to bind to this field
  // e.g. employed, company
  entity: Destination;
  // TODO customFilter: (value: string, query: string, item?: {value: any}) => boolean
}>();

const dialogStore = useDialogStore();

const model = defineModel<Link<typeof props.entity>>();

const search = ref("");

const useListEntity = createEntityStore(props.entity);
const entityStore = useListEntity();
const { entities } = storeToRefs(entityStore);

const entitiesList = computed(() =>
  Object.entries(entities.value ?? {}).map(([key, value]) => {
    return new Link<typeof props.entity>(props.entity, key, value.name);
  }),
);

function addNewItem() {
  const newEntityName = search.value;
  if (newEntityName) {
    // Clear the search input after triggering the add new item action
    // This prevents the "Add new..." option from reappearing immediately
    // if the dialog is closed without selecting the newly created item.
    search.value = "";
    dialogStore.open({
      type: props.entity,
      name: newEntityName,
      callback: (name, key) => {
        if (!key) {
          console.warn("failed to obtain key for new entity: ", name);
          // TODO log on the server all console.warns and higher
          return;
        }
        model.value = new Link<typeof props.entity>(props.entity, key, name);
      },
    });
  }
}
</script>
