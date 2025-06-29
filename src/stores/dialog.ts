// src/stores/dialog.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useListEntity } from '@/composables/entity';
import type { Destination } from '@/composables/model';
import type { DestinationTypeMap } from '@/composables/model';

interface NewEntityPayload<D extends Destination> {
  name: string;      // name of the dialog to open
  type: D;          // what type of dialog to open
  edit?: {
    value: DestinationTypeMap[D]    // value to prepopulate with
    key: string
  }
  defaultValue: () => DestinationTypeMap[D]
}

export const config: Record<Destination, {title: string, titleIcon: string}> = {
  data: {
    title: "Dodaj nowy artykuł",
    titleIcon: "mdi-file-document-plus-outline"
  },
  employed: {
    title: "Dodaj nową osobę",
    titleIcon: "mdi-account-plus-outline"
  },
  company: {
    title: "Dodaj miejsce pracy",
    titleIcon: "mdi-domain"
  },
  suggestion: {
    title: "Dodaj pomysł na stronę",
    titleIcon: "mdi-lightbulb-on-10"
  }
}

// Values shown by the dialog tab
interface Dialog<D extends Destination> {
  value: DestinationTypeMap[D]
  type: D
}

export const useDialogStore = defineStore('dialog', () => {
  const dialogs = ref<Dialog<Destination>[]>([]);
  const currentDialog = ref<number>()
  const shown = ref(false)
  const showSnackbar = ref(false)
  type Idx = number

  function open<D extends Destination>(payload: NewEntityPayload<D>) {
    shown.value = true
    const dialog: Dialog<D> = {
      value: payload.edit?.value || payload.defaultValue(),
      type: payload.type
      // TODO remove component: markRaw(lookupComponent(payload.type)),
      // TODO remove payload: markRaw(payload)
    }
    console.log(dialog)
    const len = dialogs.value.push(dialog)
    currentDialog.value = len - 1
  }

  function close(idx: Idx, shouldSubmit: boolean) {
    if (shouldSubmit) {
      const { submit } = useListEntity(dialogs.value[idx].type)
      submit(dialogs.value[idx].value) // TODO handle edit
    }
    remove(idx)
  }

  function remove(idx: Idx) {
    dialogs.value.splice(idx)
    if (currentDialog.value ?? -1 >= dialogs.value.length) currentDialog.value = dialogs.value.length - 1
    if (dialogs.value.length == 0) {
      currentDialog.value = undefined
      shown.value = false
    }
  }

  return { dialogs, shown, currentDialog, showSnackbar, open, close };
});
