import { defineStore } from "pinia";
import { ref } from "vue";
import type { NodeType, NodeTypeMap } from "@/../shared/model";

export type Callback = (name: string, key?: string) => void;

// TODO this could be a class and have everything defined already
export interface NewEntityPayload<N extends NodeType> {
  type: N; // what type of dialog to open
  name?: string; // name to populate if given
  edit?: {
    value: Partial<NodeTypeMap[N]>; // value to prepopulate with
    key: string;
  };
  callback?: Callback;
}

export const config: Record<NodeType, { title: string; titleIcon: string }> = {
  article: {
    title: "Dodaj nowy artykuł",
    titleIcon: "mdi-file-document-plus-outline",
  },
  person: {
    title: "Dodaj nową osobę",
    titleIcon: "mdi-account-plus-outline",
  },
  place: {
    title: "Dodaj miejsce pracy",
    titleIcon: "mdi-domain",
  },
  record: {
    title: "Dodaj nowy rekord",
    titleIcon: "mdi-file-document-plus-outline",
  },
};

// Values shown by the dialog tab
interface Dialog<N extends NodeType> {
  value: Partial<NodeTypeMap[N]>;
  type: N;
  editKey?: string;
  callback?: Callback;
}

export const useDialogStore = defineStore("dialog", () => {
  const { entities: people, submit: submitPerson } = useEntity("person");
  const { entities: companies, submit: submitCompany } = useEntity("place");
  const { entities: articles, submit: submitArticle } = useEntity("article");

  function lookupSubmit(type: NodeType) {
    switch (type) {
      case "person":
        return submitPerson;
      case "place":
        return submitCompany;
      case "article":
        return submitArticle;
    }
    // This should not happen
    return null;
  }

  const dialogs = ref<Dialog<NodeType>[]>([]);
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

  function open<N extends NodeType>(payload: NewEntityPayload<N>) {
    shown.value = true;
    const dialog: Dialog<N> = {
      value: payload.edit?.value ?? {},
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
        type: "person",
        edit: { value: people.value[node] ?? {}, key: node },
      });
      return;
    }
    if (companies.value && node in companies.value) {
      open({
        type: "place",
        edit: { value: companies.value[node] ?? {}, key: node },
      });
      return;
    }
    if (articles.value && node in articles.value) {
      open({
        type: "article",
        edit: { value: articles.value[node] ?? {}, key: node },
      });
    }
  }

  function close(idx: Idx, shouldSubmit: boolean) {
    const dialog = dialogs.value[idx];
    if (!dialog) return;

    let key = dialog.editKey;
    if (shouldSubmit) {
      const submit = lookupSubmit(dialog.type);
      if (submit) {
        key = submit(dialog.value, dialog.type, dialog.editKey).key;
      }
    }
    if (dialog.callback) {
      dialog.callback(dialog.value.name || "", key);
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
