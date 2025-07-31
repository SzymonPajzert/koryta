import { useRTDB } from "@vueuse/firebase/useRTDB";
import { db } from "@/firebase";
import {
  ref as dbRef,
  push,
  set,
  type ThenableReference,
} from "firebase/database";
import type { DestinationTypeMap } from "../composables/model";
import { useAuthState } from "../composables/auth";
import { removeBlanks, type Destination } from "../composables/model";

const { user, isAdmin } = useAuthState();

export function createEntityStore<D extends Destination>(entity: D) {
  return defineStore("entity_" + entity, () => {
    type T = DestinationTypeMap[D];

    const entitiesApproved = useRTDB<Record<string, T>>(dbRef(db, entity));
    const suggestions = computed(() => {
      const { user } = useAuthState();
      if (user.value && user.value.uid) {
        return useRTDB<Record<string, T>>(
          dbRef(db, `suggestions/${user.value?.uid}/${entity}`),
        ).value;
      }
      return {};
    });
    const entities = computed(() => ({
      ...entitiesApproved.value,
      ...suggestions.value,
    }));

    function submitPath(editKey: string | undefined): string {
      let result = `suggestions/${user.value?.uid}/${entity}`; // Everything else goes to suggestion
      if (isAdmin.value) result = entity; // Only admins can actually edit
      if (editKey) result = `${result}/${editKey}`;
      return result;
    }

    function operation(editKey: string | undefined) {
      let operation = push;
      if (editKey && isAdmin.value) {
        operation = (parent, value) => {
          set(parent, value);
          return { key: editKey, ref: parent } as ThenableReference;
        };
      }
      return operation;
    }

    function submit<D extends Destination>(
      value: DestinationTypeMap[D],
      d: D,
      editKey: string | undefined,
    ) {
      if (!user.value?.uid) {
        return { error: "User not authenticated or UID not available." };
      }

      const path = dbRef(db, submitPath(editKey));
      console.debug("before removal: ", value);

      const op = operation(editKey);
      value = removeBlanks(value);
      console.debug("trying to write: ", value);

      const keyRef = op(path, {
        ...value,
        date: Date.now(),
        user: user.value?.uid,
      }).key;
      if (editKey) {
        push(
          dbRef(db, `user/${user.value?.uid}/suggestions/edit/${entity}`),
          keyRef,
        );
      } else {
        push(
          dbRef(db, `user/${user.value?.uid}/suggestions/add/${entity}`),
          keyRef,
        );
      }
      return { key: keyRef };
    }

    return { entities, suggestions, submit };
  });
}
