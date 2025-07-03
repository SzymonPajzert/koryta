// src/stores/dialog.ts
import { defineStore } from "pinia";
import { ref } from "vue";
import { useListEntity } from "@/composables/entity";
import { empty, fillBlankRecords, type Destination } from "@/composables/model";
import type { DestinationTypeMap } from "@/composables/model";

// TODO this could be a class and have everything defined already
interface NewEntityPayload<D extends Destination> {
  type: D; // what type of dialog to open
  edit?: {
    value: DestinationTypeMap[D]; // value to prepopulate with
    key: string;
  };
}

export const config: Record<Destination, { title: string; titleIcon: string }> =
  {
    data: {
      title: "Dodaj nowy artykuł",
      titleIcon: "mdi-file-document-plus-outline",
    },
    employed: {
      title: "Dodaj nową osobę",
      titleIcon: "mdi-account-plus-outline",
    },
    company: {
      title: "Dodaj miejsce pracy",
      titleIcon: "mdi-domain",
    },
    suggestion: {
      title: "Dodaj pomysł na stronę",
      titleIcon: "mdi-lightbulb-on-10",
    },
  };

// Values shown by the dialog tab
interface Dialog<D extends Destination> {
  value: DestinationTypeMap[D];
  type: D;
  editKey?: string;
}

export const useDialogStore = defineStore("dialog", () => {
  const dialogs = ref<Dialog<Destination>[]>([]);
  const currentDialog = ref<number>();
  const shown = ref(false);
  const showSnackbar = ref(false);
  type Idx = number;

  // TODO open could be just type and optional edit payload (value and key to submit)
  function open<D extends Destination>(payload: NewEntityPayload<D>) {
    const defaultValue = () => empty(payload.type);
    const filler = (r: DestinationTypeMap[D]) =>
      fillBlankRecords(r, payload.type);

    shown.value = true;
    const dialog: Dialog<D> = {
      value: filler(payload.edit?.value || defaultValue()),
      type: payload.type,
      editKey: payload.edit?.key,
    };
    console.log(dialog);
    const len = dialogs.value.push(dialog);
    currentDialog.value = len - 1;
  }

  function close(idx: Idx, shouldSubmit: boolean) {
    if (shouldSubmit) {
      const { submit } = useListEntity(dialogs.value[idx].type);
      submit(dialogs.value[idx].value, dialogs.value[idx].editKey); // TODO handle edit
    }
    remove(idx);
  }

  function remove(idx: Idx) {
    dialogs.value.splice(idx);
    if (currentDialog.value ?? -1 >= dialogs.value.length)
      currentDialog.value = dialogs.value.length - 1;
    if (dialogs.value.length == 0) {
      currentDialog.value = undefined;
      shown.value = false;
    }
  }

  return { dialogs, shown, currentDialog, showSnackbar, open, close };
});
