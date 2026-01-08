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
    @update:focused="(val: boolean) => val && refresh()"
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

const model = defineModel<Link<typeof props.entity>>();

const search = ref("");

const { idToken } = useAuthState();

const headers = computed(() => {
  const h: Record<string, string> = {};
  if (idToken.value) {
    h.Authorization = `Bearer ${idToken.value}`;
  }
  return h;
});

const { data: response, refresh } = await useFetch(
  `/api/nodes/${props.entity}`,
  {
    key: `api-nodes-${props.entity}-${idToken.value ? "auth" : "guest"}`,
    headers: headers,
    lazy: true,
    watch: [idToken],
  },
);

const entitiesList = computed(() => {
  const ents = response.value?.entities ?? {};
  return Object.entries(ents).map(([key, value]) => ({
    type: props.entity,
    id: key,
    name: value.name,
  }));
});

function addNewItem() {
  const newEntityName = search.value;
  if (newEntityName) {
    // Clear the search input after triggering the add new item action
    search.value = "";

    // Open new tab with prepopulated data
    const url = `/edit/node/new?type=${props.entity}&name=${encodeURIComponent(newEntityName)}`;
    window.open(url, "_blank");
  }
}
</script>
