// src/stores/dialog.ts
import { defineStore } from 'pinia';
import { markRaw, type Component, ref } from 'vue';
import { type Destination, type Nameable } from '@/composables/entity';
import AddCompanyDialog from '@/components/dialog/AddCompanyDialog.vue';
import AddArticleDialog from '@/components/dialog/AddArticleDialog.vue';
import AddSuggestionDialog from '@/components/dialog/AddSuggestionDialog.vue';
import AddBatchEmployedDialog from '@/components/dialog/AddBatchEmployedDialog.vue';
import AddEmployedDialog from '@/components/dialog/AddEmployedDialog.vue';

export interface DialogType {
  entity: Destination
  format?: "batch"
}

function lookupComponent(d: DialogType) {
  switch(d.entity) {
    case 'employed':
      if (d.format == 'batch') return AddBatchEmployedDialog
      return AddEmployedDialog
    case 'company':
      return AddCompanyDialog
    case 'data':
      return AddArticleDialog
    case 'suggestion':
      return AddSuggestionDialog
  }
}

interface NewEntityPayload<T extends Nameable> {
  name: string;      // name of the dialog to open
  type: DialogType;  // what type of dialog to open
  edit?: {
    value: T    // value to prepopulate with
    key: string
  }
  defaultValue: () => T
}

interface Dialog {
  component: Component
  value: Nameable
  show: boolean
  props?: Record<string, unknown>
}

export const useDialogStore = defineStore('dialog', () => {
  const dialogs = ref<Dialog[]>([]);
  const currentDialog = ref<number>()
  const shown = ref(false)
  type Idx = number

  function open<T extends Nameable>(payload: NewEntityPayload<T>) {
    shown.value = true
    const dialog: Dialog = {
      component: lookupComponent(payload.type), // TODO markRaw
      value: payload.edit?.value || payload.defaultValue(),
      show: true,
    }
    const len = dialogs.value.push(dialog)
    currentDialog.value = len - 1
  }

  function close(idx: Idx, data?: unknown, isSuccess = true) {
    dialogs.value.splice(idx)
    if (currentDialog.value ?? -1 >= dialogs.value.length) currentDialog.value = dialogs.value.length - 1
    if (dialogs.value.length == 0) {
      currentDialog.value = undefined
      shown.value = false
    }
  }

  return { dialogs, shown, currentDialog, open, close };
});
