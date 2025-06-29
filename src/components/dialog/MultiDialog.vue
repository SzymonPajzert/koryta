<script lang="ts" setup>
// MultiDialog component is responsible for rendering multiple dialog at once, possibly with the same component type.
// It uses useDialogStore to keep track of the opened dialogs and their values
//
// It's a replacement for just listing unique types of all the dialog components.
import { useDialogStore } from '@/stores/dialog'
import { storeToRefs } from 'pinia'

const dialogStore = useDialogStore()
const { dialogs, shown, currentDialog } = storeToRefs(dialogStore)

</script>

<template>
  <v-dialog v-model="shown" max-width="800">
    <v-card>
      <v-tabs
        v-model="currentDialog"
        selected-class="bg-success">
        <v-tab v-for="(dialog, id) in dialogs" :key="id" :value="id" variant="tonal">
          {{ dialog.value.name }}
        </v-tab>
      </v-tabs>
      <v-card-text class="overflow-y-auto">
        <v-tabs-window v-model="currentDialog">
          <v-tabs-window-item v-for="(dialog, id) in dialogs" :key="id" :value="id">
            <component
              :is="dialog.component"
              :store-id="id"
              @close="dialogStore.close(id, $event, false)"
              @submit="dialogStore.close(id, $event, true)"
            />
          </v-tabs-window-item>
        </v-tabs-window>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
