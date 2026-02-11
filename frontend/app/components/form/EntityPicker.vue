<template>
  <v-autocomplete
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
    v-bind="{
      ...$attrs,
      'data-testid': $attrs['data-testid'] || 'entity-picker-input',
    }"
    @update:focused="(val: boolean) => val && refresh()"
  >
    <template #no-data>
      <v-list-item
        v-if="search"
        data-testid="add-new-entity"
        @click="addNewItem"
      >
        <v-list-item-title>
          Dodaj "<strong>{{ search }}</strong
          >" do bazy.
        </v-list-item-title>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

import type { NodeType, Link, Person, Company, Article } from "~~/shared/model";

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

const { authFetch } = useAuthState();

const { data: response, refresh } = authFetch<{
  entities: Record<string, Person | Company | Article>;
}>(`/api/nodes/${props.entity}`, {
  lazy: true,
});

const entitiesList = computed(() => {
  const ents = response.value?.entities ?? {};
  const list = Object.entries(ents).map(([key, value]) => ({
    type: props.entity,
    id: key,
    name: value.name,
  }));

  if (model.value && !list.find((e) => e.id === model.value?.id)) {
    list.push(model.value);
  }

  return list;
});

async function addNewItem() {
  const newEntityName = search.value;
  if (newEntityName) {
    // Clear the search input after triggering the add new item action
    search.value = "";

    const { data, error } = await authFetch<{ id: string }>(
      `/api/nodes/create`,
      {
        method: "POST",
        body: {
          type: props.entity,
          name: newEntityName,
        },
      },
    );

    if (error.value) {
      console.error("Failed to create entity:", error.value);
      return;
    }

    const id = data.value?.id;

    if (id) {
      await refresh();

      // Select the newly created item
      model.value = {
        type: props.entity,
        id,
        name: newEntityName,
      };

      // Force update the search input to show the name
      search.value = newEntityName;
    }
  }
}
</script>
