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
import type { Node, NodeType, Article } from "~~/shared/model";
import { useDialogStore } from "@/stores/dialog";
import { compareTwoStrings } from "string-similarity";

const dialogStore = useDialogStore();
const model = defineModel<string>({ required: true });
const { entity, create } = defineProps<{
  entity: NodeType;
  create?: boolean;
}>();

const { entities } = await useEntity(entity);
const max = 5;

type Entry<T> = [string, T & { similarity: number; equal: boolean }];

const closest = computed(() => {
  if (!model.value) return [];
  if (!entities.value) return [];

  const result = Object.entries(entities.value)
    .map(entitySimilarity(entity, model.value))
    .sort(entitySort());
  return result.slice(0, max);
});

function entitySimilarity<T extends { name: string }, N extends NodeType>(
  d: N,
  match: string,
): (a: [string, T]) => Entry<T> {
  return ([key, obj]) => {
    let value = obj.name;
    if (d == "article") {
      // TODO this is badly typed
      value = (obj as unknown as Article).sourceURL;
    }
    return [
      key,
      {
        ...obj,
        similarity: compareTwoStrings(match, value),
        equal: value == match,
      },
    ];
  };
}

function entitySort<T>(): (a: Entry<T>, b: Entry<T>) => number {
  return (a, b) => {
    return b[1].similarity - a[1].similarity;
  };
}
</script>
