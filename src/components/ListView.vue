<template>
  <div>
    <UserDetailDialog ref="dialog"></UserDetailDialog>
    <v-row>
      <v-col
        v-for="[key, person] in peopleOrdered"
        :key="person.name"
        cols="12"
        sm="6"
      >
        <v-card
          class="py-4"
          color="surface-variant"
          prepend-icon="mdi-account-outline"
          rounded="lg"
          variant="tonal"
          height="100%"
          @click="showUser(key)"
        >
          <template #title>
            <PartyChip v-for="party in person.parties" :key="party" :party />
            <h2 class="text-h5 font-weight-bold">
              {{ person.name }}
            </h2>
          </template>

          <v-card-text>
            <p v-for="connection in person.connections" :key="connection.text">
              {{ connectionText(connection) }}
            </p>
            <br />
            <p v-for="employment in person.employments" :key="employment.text">
              {{ connectionText(employment) }}
            </p>
          </v-card-text>
          <v-card-actions v-if="isAdmin">
            <v-spacer></v-spacer>
            <v-btn
              @click.stop="
                dialogStore.open({
                  type: 'employed',
                  edit: { value: person, key: key },
                })
              "
              variant="tonal"
              prepend-icon="mdi-pencil-outline"
            >
              <template #prepend>
                <v-icon color="warning"></v-icon>
              </template>
              Edytuj
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { type Connection, type NepoEmployment } from "@/composables/model";
import PartyChip from "./PartyChip.vue";
import { useAuthState } from "@/composables/auth";
import UserDetailDialog from "@/components/dialog/UserDetailDialog.vue";
import { useDialogStore } from "@/stores/dialog"; // Import the new store

const dialogStore = useDialogStore();
const { isAdmin } = useAuthState();
const dialog = ref<typeof UserDetailDialog>();

function showUser(key: string) {
  if (!dialog.value) return;
  dialog.value.setNode(key);
}

function connectionText(connection: Connection) {
  if (connection.text != "") return connection.text;
  if (connection.connection?.text && connection.relation != "") {
    return connection.relation + " " + connection.connection?.text;
  }
  return "";
}

type SortedEmployment = NepoEmployment & { descriptionLen: number };

const { people } = defineProps<{ people: Record<string, NepoEmployment> }>();
const peopleOrdered = computed<[string, SortedEmployment][]>(() => {
  const result = Object.entries(people ?? {}).map(
    ([key, value]) =>
      [
        key,
        {
          ...value,
          descriptionLen:
            Object.values(value.employments ?? {})
              .map((e) => e.text.length)
              .reduce((a, b) => a + b, 0) +
            Object.values(value.connections ?? {})
              .map((e) => e.text.length)
              .reduce((a, b) => a + b, 0),
        },
      ] as [string, SortedEmployment],
  );
  result.sort(
    (a, b) => (b[1].descriptionLen ?? 0) - (a[1].descriptionLen ?? 0),
  );
  return result;
});
</script>
