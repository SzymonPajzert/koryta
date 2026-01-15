<template>
  <div class="already-existing-wrapper">
    <v-text-field v-bind="$attrs" v-model="model" data-testid="already-existing-input" hide-details />
    <v-list v-if="create && closest.length > 0" data-testid="similar-suggestions">
      <v-list-item
        v-for="([key, item], index) in closest"
        :key="index"
        class="w-100"
        @click="onSelect(key, item)"
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
  </div>
</template>

<script lang="ts" setup>
defineOptions({
  inheritAttrs: false,
});
import type { NodeType, Article } from "~~/shared/model";
import { useDialogStore } from "@/stores/dialog";
import { compareTwoStrings } from "string-similarity";

const dialogStore = useDialogStore();
const model = defineModel<string>({ required: true });
const {
  entity,
  create,
  max = 3,
  navigate = false,
} = defineProps<{
  entity: NodeType;
  create?: boolean;
  max?: number;
  navigate?: boolean;
}>();

const { entities } = await useEntity(entity);

function onSelect(key: string, item: any) {
  if (navigate) {
    navigateTo(`/edit/node/${key}`);
  } else {
    dialogStore.open({ type: entity, edit: { value: item, key: key } });
  }
}

type Entry<T> = [string, T & { similarity: number; equal: boolean }];

const closest = computed(() => {
  if (!model.value) return [];
  if (!entities.value) return [];

  const result = Object.entries(entities.value)
    .map(entitySimilarity(entity, model.value))
    .filter(([, item]) => item.similarity > 0.1)
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
