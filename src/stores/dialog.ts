// src/stores/dialog.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { type Destination, Link } from '@/composables/entity';

export interface DialogType {
  entity: Destination
  format?: "batch"
}

interface NewEntityPayload {
  name: string;
  type: DialogType;
}

export const useDialogStore = defineStore('dialog', () => {
  const showNewEntityDialog = ref(false);
  const newEntityPayload = ref<NewEntityPayload | null>(null);
  const lastCreatedEntity = ref<Link<Destination> | null>(null); // To hold the newly created entity

  function openNewEntityDialog(payload: NewEntityPayload) {
    newEntityPayload.value = payload;
    showNewEntityDialog.value = true;
    lastCreatedEntity.value = null; // Clear previous created entity
  }

  function closeNewEntityDialog(createdLink?: Link<Destination>) {
    showNewEntityDialog.value = false;
    newEntityPayload.value = null; // Clear payload after closing
    lastCreatedEntity.value = createdLink || null; // Set if an entity was created
  }

  return { showNewEntityDialog, newEntityPayload, lastCreatedEntity, openNewEntityDialog, closeNewEntityDialog };
});
