// src/stores/dialog.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { type Destination, Link, type Nameable } from '@/composables/entity';

export interface DialogType {
  entity: Destination
  format?: "batch"
}

export function dialogTypeStr(d: DialogType) {
  return `${d.entity}_${d.format}`
}

interface NewEntityPayload {
  name: string;      // name of the dialog to open
  type: DialogType;  // what type of dialog to open
  edit?: {
    value: Nameable    // value to prepopulate with
    key: string
  }
}

export const useDialogStore = defineStore('dialog', () => {
  const showNewEntityDialog = ref<Record<string, boolean>>({});
  const newEntityPayload = ref<NewEntityPayload | null>(null);

  function openNewEntityDialog(payload: NewEntityPayload) {
    newEntityPayload.value = payload;
    showNewEntityDialog.value[dialogTypeStr(payload.type)] = true;
  }

  function closeNewEntityDialog(dialogType: DialogType) {
    showNewEntityDialog.value[dialogTypeStr(dialogType)] = false;
    newEntityPayload.value = null; // Clear payload after closing
  }

  return { showNewEntityDialog, newEntityPayload, openNewEntityDialog, closeNewEntityDialog };
});
