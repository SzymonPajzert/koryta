<template>
  <v-list>
    <!-- TODO turn into an entity picker -->
    <v-list-item class="mb-2" @click="dialogStore.open({ type: 'data' })">
      <v-list-item-title> Dodaj źródło </v-list-item-title>
    </v-list-item>
    <v-list-item
      class="mb-2"
      @click="dialogStore.open({ type: 'todo', callback: todoConsumer })"
    >
      <v-list-item-title> Dodaj zadanie </v-list-item-title>
    </v-list-item>
    <ArticleBacklink
      v-for="(source, id) in articles"
      width="100%"
      dense
      :article="source"
      :articleID="id"
    />
  </v-list>
</template>

<script lang="ts" setup>
import { useArticles } from "@/composables/entities/articles";
import { useDialogStore, type Callback } from "@/stores/dialog";

const { id, todoConsumer } = defineProps<{
  id?: string;
  todoConsumer: Callback;
}>();

const dialogStore = useDialogStore();
const { entityArticles } = useArticles();
const articles = computed(() => {
  if (!id) return {};
  return entityArticles.value[id];
});
</script>
