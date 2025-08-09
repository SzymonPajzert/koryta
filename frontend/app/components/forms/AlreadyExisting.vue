<template>
  <v-text-field v-bind="$attrs" v-model="model" hide-details />
  <v-list v-if="create">
    <v-list-item
      v-for="([key, item], index) in closest"
      :key="index"
      class="w-100"
      @click="
        dialogStore.open({ type: entity, edit: { value: item, key: key } })
      "
    >
      <v-list-item-title
        ><span
          :style="
            item.equal
              ? { 'font-weight': 'bold', 'font-style': 'italic' }
              : undefined
          "
          >{{ item.name }}</span
        ></v-list-item-title
      >
    </v-list-item>
  </v-list>
</template>

<script lang="ts" setup>
import { useEntitiesFiltered } from "@/composables/entities/filtered";
import type { Destination } from "~~/shared/model";
import { useDialogStore } from "@/stores/dialog";

const dialogStore = useDialogStore();
const model = defineModel<string>({ required: true });
const { entity, create } = defineProps<{
  entity: Destination;
  create?: boolean;
}>();
const { closest } = useEntitiesFiltered(entity, model, 3);
</script>
