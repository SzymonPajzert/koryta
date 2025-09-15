<template>
  <div>
    <UserDetailDialog ref="dialog" />
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
            <br >
            <p v-for="employment in person.employments" :key="employment.text">
              {{ connectionText(employment) }}
            </p>
          </v-card-text>
          <v-card-actions v-if="isAdmin">
            <v-spacer />
            <v-btn
              variant="tonal"
              prepend-icon="mdi-pencil-outline"
              @click.stop="
                dialogStore.open({
                  type: 'employed',
                  edit: { value: person, key: key },
                })
              "
            >
              <template #prepend>
                <v-icon color="warning" />
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
import type { Connection, Person, Destination} from "~~/shared/model";
import PartyChip from "./PartyChip.vue";
import { useAuthState } from "@/composables/auth";
import UserDetailDialog from "@/components/dialog/UserDetailDialog.vue";
import { useDialogStore } from "@/stores/dialog"; // Import the new store

const dialogStore = useDialogStore();
const { isAdmin } = useAuthState();
const dialog = ref<typeof UserDetailDialog>();
const router = useRouter();

function showUser(key: string) {
  router.push(`/entity/employed/${key}`);
}

function connectionText<D extends Destination>(connection: Connection<D>) {
  if (connection.text != "") return connection.text;
  if (connection.connection?.text && connection.relation != "") {
    return connection.relation + " " + connection.connection?.text;
  }
  return "";
}

const { people } = defineProps<{ people: Record<string, Person> }>();
const peopleOrdered = computed<[string, Person][]>(() => {
  const result = Object.entries(people ?? {});
  result.sort((a, b) => a[1].name.localeCompare(b[1].name));
  return result;
});
</script>
