<template>
  <v-row dense>
    <v-col cols="12" md="4" sm="6">
      <v-select
        v-model="current.parties"
        :items="partiesDefault"
        label="Partia"
        multiple
        chips
        deletable-chips
        required
      />
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { getFirestore, doc } from "firebase/firestore";
import type { Person } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});

const route = useRoute<"/edit/node/[id]">();
const node = route.params.id as string;

const db = getFirestore(useFirebaseApp(), "koryta-pl");
const value = useDocument(doc(db, "nodes", node));

console.log(value);

const current = ref<Person>({ name: "", parties: [] });

const { parties } = usePartyStatistics();
const partiesDefault = computed<string[]>(() => [...parties.value, "inne"]);
</script>
