<template>
  <v-dialog v-model="shown" max-width="800">
    <v-card>
      <v-tabs v-model="currentDialog" selected-class="bg-success">
        <v-tab value="-1" variant="tonal"> Wybierz typ </v-tab>
        <v-tab
          v-for="(dialog, id) in dialogs"
          :key="id"
          :value="id"
          variant="tonal"
        >
          {{ dialog.value.name.slice(0, 20) }}
        </v-tab>
      </v-tabs>
      <v-card-text class="overflow-y-auto">
        <v-tabs-window v-model="currentDialog">
          <v-tabs-window-item value="-1">
            <OpenAbstractDialog dialog="article" />
            <OpenAbstractDialog dialog="person" />
            <OpenAbstractDialog dialog="place" />
          </v-tabs-window-item>
          <v-tabs-window-item
            v-for="(dialog, id) in dialogs"
            :key="id"
            :value="id"
          >
            <v-card
              :prepend-icon="config[dialog.type].titleIcon"
              :title="config[dialog.type].title"
            >
              <v-card-text>
                <component
                  :is="lookupComponent(dialog.type)"
                  :id="dialog.editKey"
                  v-model="dialog.value"
                  :create="!dialog.editKey"
                  @close="dialogStore.close(id, false)"
                  @submit="dialogStore.close(id, true)"
                />
              </v-card-text>
              <v-divider />
              <v-card-actions>
                <v-spacer />

                <v-btn
                  text="Anuluj"
                  variant="plain"
                  @click="dialogStore.close(id, false)"
                />

                <v-btn
                  color="primary"
                  :text="dialog.editKey ? 'Zapisz' : 'Dodaj'"
                  variant="tonal"
                  @click="dialogStore.close(id, true)"
                />
              </v-card-actions>
            </v-card>
          </v-tabs-window-item>
        </v-tabs-window>
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-snackbar
    v-model="showSnackbar"
    :timeout="3000"
    color="success"
    location="top end"
  >
    Sugestia została pomyślnie dodana!
    <template #actions>
      <v-btn variant="text" @click="showSnackbar = false"> Zamknij </v-btn>
    </template>
  </v-snackbar>
</template>

<script lang="ts" setup>
// MultiDialog component is responsible for rendering multiple dialog at once, possibly with the same component type.
// It uses useDialogStore to keep track of the opened dialogs and their values
//
// It's a replacement for just listing unique types of all the dialog components.
import { useDialogStore, config } from "@/stores/dialog";
import { storeToRefs } from "pinia";
import type { NodeType, NodeTypeMap } from "~~/shared/model";
import {
  DialogAddEmployed,
  DialogAddCompany,
  DialogAddArticle,
} from "#components";

const dialogStore = useDialogStore();
const { dialogs, shown, currentDialog, showSnackbar } =
  storeToRefs(dialogStore);

function lookupComponent<N extends NodeType>(
  n: N,
): Component<{ modelValue: NodeTypeMap[N] }>;
function lookupComponent<N extends NodeType>(n: N) {
  if (n == "person") {
    return DialogAddEmployed;
  }
  if (n == "place") {
    return DialogAddCompany;
  }
  if (n == "article") {
    return DialogAddArticle;
  }

  return undefined as unknown;
}
</script>
