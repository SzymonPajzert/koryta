<template>
  <div class="already-existing-wrapper">
    <v-text-field
      v-bind="$attrs"
      v-model="model"
      data-testid="already-existing-input"
      hide-details
    />
    <v-card
      v-if="create && closest.length > 0 && showSuggestions"
      class="mt-2"
      variant="outlined"
      density="compact"
    >
      <div
        class="d-flex align-center justify-space-between px-2 pt-1 bg-green-lighten-4"
      >
        <span class="text-caption text-grey-darken-1 font-weight-medium"
          >Podobne wpisy</span
        >
        <v-btn
          icon="mdi-close"
          variant="text"
          size="x-small"
          density="compact"
          color="grey"
          @click="showSuggestions = false"
        />
      </div>
      <v-divider />
      <v-list data-testid="similar-suggestions" density="compact" class="py-0">
        <v-list-item
          v-for="([key, item], index) in closest"
          :key="index"
          class="w-100"
          @click="onSelect(key)"
        >
          <v-list-item-title class="text-caption">
            <span
              :style="
                item.equal
                  ? { 'font-weight': 'bold', 'font-style': 'italic' }
                  : undefined
              "
              >{{ item.name }}</span
            >
          </v-list-item-title>
        </v-list-item>
      </v-list>
    </v-card>
  </div>
</template>

<script lang="ts" setup>
import type { NodeType, Article } from "~~/shared/model";
import { compareTwoStrings } from "string-similarity";

defineOptions({
  inheritAttrs: false,
});

const model = defineModel<string | undefined>({ required: true });
const {
  entity,
  create,
  max = 3,
} = defineProps<{
  entity: NodeType;
  create?: boolean;
  max?: number;
}>();

const showSuggestions = ref(true);

watch(model, () => {
  showSuggestions.value = true;
});

const { entities } = await useEntity(entity);

function onSelect(key: string) {
  navigateTo(`/edit/node/${key}`);
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
