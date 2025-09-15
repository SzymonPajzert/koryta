<template>
  <h3>
    {{ props.title }}
  </h3>
  <div
    v-for="(key, index) in keys"
    :key="key"
    align="center"
    dense
    class="d-flex align-center mb-4 w-100"
  >
    <slot :value="connections[key]" />
    <div class="d-flex flex-column">
      <v-btn
        icon
        slim
        size="small"
        density="comfortable"
        variant="text"
        color="grey"
        @click="addItem()"
      >
        <v-tooltip>Dodaj kolejne</v-tooltip>
        <v-icon>mdi-plus-circle</v-icon>
      </v-btn>
      <v-btn
        icon
        slim
        size="small"
        density="comfortable"
        variant="text"
        color="grey"
        :disabled="keys.length <= 1"
        @click="removeItem(index)"
      >
        <v-tooltip>Usuń</v-tooltip>
        <v-icon>mdi-minus-circle</v-icon>
      </v-btn>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useDBUtils } from "@/composables/model";
import type { EdgeType } from "~~/shared/model";
const { newKey } = useDBUtils();

const connections = ref({});
const keys = ref(Object.keys(connections.value));

const props = defineProps<{
    title: string
    edgeType: EdgeType
    sourceId: string
    edgeReverse?: boolean
  }>();

const addItem = () => {
  const key = newKey();
  connections.value[key] = undefined;
  keys.value.push(key);
};

const removeItem = (index: number) => {
  if (keys.value.length > 1) {
    connections.value[keys.value[index]] = undefined;
    keys.value.splice(index, 1);
  }
};
</script>
