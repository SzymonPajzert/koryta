<template>
  <v-dialog v-model="visible" max-width="500">
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
        <br />
        <p v-for="employment in person?.employments" :key="employment.text">
          {{ employment.text }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          @click.stop="dialogStore.open({
            name: '',
            type: 'employed',
            edit: { value: person, key: node  },
            defaultValue: () => empty('employed')
          })"
          variant="tonal"
          prepend-icon="mdi-pencil-outline">
          <template #prepend>
            <v-icon color="warning"></v-icon>
          </template>
          Edytuj
        </v-btn>
        <v-btn variant="tonal" @click="visible = false">Zamknij</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
import { useListEmployment } from "@/composables/party";
import { useDialogStore } from "@/stores/dialog";
import { empty } from "@/composables/model"

const dialogStore = useDialogStore();

const visible = ref(false);
const node = ref<string | undefined>();
const { people } = useListEmployment();

const person = computed(() => {
  if (!people.value) return;
  if (!node.value) return;
  return people.value?.[node.value];
});

// This exposes the node setting option, so the users of this component can just call it.
defineExpose({
  setNode: function (nodeId: string) {
    node.value = nodeId;
    visible.value = true;
  },
});
</script>
