// src/stores/dialog.ts
import { defineStore } from "pinia";
import { ref } from "vue";
import { createEntityStore } from "@/stores/entity";
import { empty, fillBlankRecords, type Destination } from "@/composables/model";
import type { DestinationTypeMap } from "@/composables/model";

// callback to call after the dialog was closed
export type Callback = (name: string, key?: string) => void;

// TODO this could be a class and have everything defined already
export interface NewEntityPayload<D extends Destination> {
  type: D; // what type of dialog to open
  name?: string; // name to populate if given
  edit?: {
    value: Partial<DestinationTypeMap[D]>; // value to prepopulate with
    key: string;
  };
  callback?: Callback;
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
    todo: {
      title: "Dodaj zadanie",
      titleIcon: "mdi-lightbulb-on-10",
    },
    "external/rejestr-io/krs": {
      title: "Dodaj organizację KRS",
      titleIcon: "mdi-office-building-outline",
    },
    "external/rejestr-io/person": {
      title: "Dodaj osobę w KRSie",
      titleIcon: "mdi-account-outline",
    },
  };

// Values shown by the dialog tab
interface Dialog<D extends Destination> {
  value: DestinationTypeMap[D];
  type: D;
  editKey?: string;
  callback?: Callback;
}

export const useDialogStore = defineStore("dialog", () => {
  const useListEmployed = createEntityStore("employed");
  const employedStore = useListEmployed();
  const { entities: people } = storeToRefs(employedStore);

  const useListCompanies = createEntityStore("company");
  const companyStore = useListCompanies();
  const { entities: companies } = storeToRefs(companyStore);

  const useListData = createEntityStore("data");
  const dataStore = useListData();
  const { entities: articles } = storeToRefs(dataStore);

  function lookupStore(type: Destination) {
    switch (type) {
      case "data":
        return dataStore;
      case "employed":
        return employedStore;
      case "company":
        return companyStore;
    }
    // This should not happen
    return dataStore;
  }

  const dialogs = ref<Dialog<Destination>[]>([]);
  const currentDialog = ref<number>();
  const shown = ref(false);
  const showSnackbar = ref(false);
  const showMain = ref(false);

  type Idx = number;

  function openMain() {
    shown.value = true;
    showMain.value = true;
    currentDialog.value = -1;
  }

  function open<D extends Destination>(payload: NewEntityPayload<D>) {
    const defaultValue = () => empty(payload.type);
    const filler = (r: Partial<DestinationTypeMap[D]>) =>
      fillBlankRecords(r, payload.type);

    shown.value = true;
    const dialog: Dialog<D> = {
      value: filler(payload.edit?.value || defaultValue()),
      type: payload.type,
      editKey: payload.edit?.key,
      callback: payload.callback ? markRaw(payload.callback) : undefined,
    };
    if (payload.name) dialog.value.name = payload.name;
    const len = dialogs.value.push(dialog);
    currentDialog.value = len - 1;
  }

  function openExisting(node: string) {
    if (node in people.value) {
      console.debug("opening user dialog");
      open({
        type: "employed",
        edit: { value: people.value[node], key: node },
      });
      return;
    }
    if (companies.value && node in companies.value) {
      open({
        type: "company",
        edit: { value: companies.value[node], key: node },
      });
      return;
    }
    if (articles.value && node in articles.value) {
      open({
        type: "data",
        edit: { value: articles.value[node], key: node },
      });
    }
  }

  function close(idx: Idx, shouldSubmit: boolean) {
    let key = dialogs.value[idx].editKey;
    if (shouldSubmit) {
      const store = lookupStore(dialogs.value[idx].type);
      key = store.submit(
        dialogs.value[idx].value,
        dialogs.value[idx].type,
        dialogs.value[idx].editKey,
      ).key;
    }
    if (dialogs.value[idx].callback) {
      dialogs.value[idx].callback(dialogs.value[idx].value.name, key);
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

  return {
    dialogs,
    shown,
    currentDialog,
    showSnackbar,
    openMain,
    open,
    openExisting,
    close,
  };
});
