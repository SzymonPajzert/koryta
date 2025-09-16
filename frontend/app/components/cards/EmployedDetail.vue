<template>
  <v-card v-if="person && node">
    <v-card-title class="headline">
      <PartyChip v-for="party in person?.parties" :key="party" :party />
      <h2 class="text-h5 font-weight-bold">
        {{ person?.name }}
      </h2>
    </v-card-title>
    <v-card-text>
      <p v-for="connection in connections(node)" :key="connection.text">
        {{ connection.text }}
      </p>
      <br />
      <p v-for="employment in employments(node)" :key="employment.text">
        {{ employment.text }}
      </p>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn
        v-if="user"
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
          <v-icon color="warning" />
        </template>
        Edytuj
      </v-btn>
      <v-btn v-if="dialog" variant="tonal" @click="close">Zamknij</v-btn>
    </v-card-actions>
  </v-card>
</template>

<script lang="ts" setup>
import { useDialogStore } from "@/stores/dialog";
import { getFirestore, doc } from "firebase/firestore";
import { useEdges } from "~/composables/edges";
import type { Person } from "~~/shared/model";

const dialogStore = useDialogStore();
const { connections, employments } = useEdges();
const { user } = useAuthState();

const { node, close } = defineProps<{
  node: string;
  close: () => void;
  dialog?: boolean;
}>();

const db = getFirestore(useFirebaseApp(), "koryta-pl");
const person = useDocument<Person>(doc(db, "nodes", node));
</script>
