<template>
  <v-card v-if="person && node">
    <v-card-title class="headline">
      <PartyChip v-for="party in person?.parties" :key="party" :party />
      <h2 class="text-h5 font-weight-bold">
        {{ person?.name }}
      </h2>
    </v-card-title>
    <v-card-text>
      <p v-for="connection in person?.connections" :key="connection.text">
        {{ connection.text }}
      </p>
      <br >
      <p v-for="employment in person?.employments" :key="employment.text">
        {{ employment.text }}
      </p>
    </v-card-text>
    <v-card-actions>
      <v-spacer/>
      <v-btn
        variant="tonal"
        prepend-icon="mdi-pencil-outline"
        @click.stop="
          dialogStore.open({
            type: 'employed',
            edit: { value: person, key: node },
          })
        "
      >
        <template #prepend>
          <v-icon color="warning"/>
        </template>
        Edytuj
      </v-btn>
      <v-btn v-if="dialog" variant="tonal" @click="close">Zamknij</v-btn>
    </v-card-actions>
  </v-card>
</template>

<script lang="ts" setup>
import { createEntityStore } from "@/stores/entity";
import { useDialogStore } from "@/stores/dialog";

const dialogStore = useDialogStore();

const { node, close } = defineProps<{
  node: string;
  close: () => void;
  dialog?: boolean;
}>();

const useListEntity = createEntityStore("employed");
const employed = useListEntity();
const { entities: people } = storeToRefs(employed);

const person = computed(() => {
  if (!people.value) return;
  if (!node) return;
  return people.value?.[node];
});
</script>
