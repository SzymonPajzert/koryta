<template>
  <v-autocomplete
    v-bind="$attrs"
    v-model="model"
    v-model:search="search"
    :label="props.label"
    :hint="props.hint"
    :items="entitiesList"
    item-title="name"
    item-value="id"
    required
    return-object
    autocomplete="off"
    data-testid="entity-picker-input"
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
      <slot name="prepend" />
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useDialogStore } from "@/stores/dialog";
import type { NodeType, Link } from "~~/shared/model";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<{
  label?: string;
  hint?: string;
  // which entity type to use to lookup suggested values to bind to this field
  // e.g. employed, company
  entity: NodeType;
}>();

const dialogStore = useDialogStore();

const model = defineModel<Link<typeof props.entity>>();

const search = ref("");

const { idToken } = useAuthState();

const { data: response } = useFetch<{
  entities: Record<string, any>;
}>(() => `/api/nodes/${props.entity}`, {
  key: `entities-picker-${props.entity}`,
  headers: computed(() => {
    const h: Record<string, string> = {};
    if (idToken.value) {
      h.Authorization = `Bearer ${idToken.value}`;
    }
    return h;
  }),
  lazy: true,
});

const entitiesList = computed(() => {
  const ents = (response.value as any)?.entities ?? {};
  return Object.entries(ents).map(([key, value]) => ({
    type: props.entity,
    id: key,
    name: (value as any).name,
  }));
});

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
          return;
        }
        model.value = {
          type: props.entity,
          id: key,
          name,
        };
      },
    });
  }
}
</script>
