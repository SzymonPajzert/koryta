import { useCollection } from 'vuefire'
import { collection } from 'firebase/firestore'
import type { DestinationTypeMap, Destination } from "@/../shared/model";
// import { useAuthState } from "@/composables/auth";
import { defineStore } from "pinia";

function entityNewLocation(entity: Destination) {
  switch (entity) {
    case "employed":
      return "person";
    case "company":
      return "place";
    case "data":
      return "article";
  }
  return entity;
}

export function createEntityStore<D extends Destination>(entity: D) {
  return defineStore("entity_" + entity, () => {
    const db = useFirestore();
    // const { removeBlanks } = useDBUtils();
    // const { user, isAdmin } = useAuthState();

    type T = DestinationTypeMap[D];

    const entitiesApproved = useCollection(collection(db, entityNewLocation(entity)))
    // TODO we need to fix IDs of references
    const entities = computed(() =>
      Object.fromEntries(entitiesApproved.value.map(e => [e["rtdb_id"], e] as [string, T])));

    // TODO restore edit
    // function submitPath(editKey: string | undefined): string {
    //   let result = `suggestions/${user.value?.uid}/${entity}`; // Everything else goes to suggestion
    //   if (isAdmin.value) result = entity; // Only admins can actually edit
    //   if (editKey) result = `${result}/${editKey}`;
    //   return result;
    // }
    // function operation(editKey: string | undefined) {
    //   let operation = push;
    //   if (editKey && isAdmin.value) {
    //     operation = (parent, value) => {
    //       set(parent, value);
    //       return { key: editKey, ref: parent } as ThenableReference;
    //     };
    //   }
    //   return operation;
    // }

    function submit<D extends Destination>(
      _value: DestinationTypeMap[D],
      _d: D,
      _editKey: string | undefined,
    ) {
      // if (!user.value?.uid) {
      //   return { error: "User not authenticated or UID not available." };
      // }

      // const path = dbRef(db, submitPath(editKey));
      // console.debug("before removal: ", value);

      // const op = operation(editKey);
      // value = removeBlanks(value);
      // console.debug("trying to write: ", value);

      // const keyRef = op(path, {
      //   ...value,
      //   date: Date.now(),
      //   user: user.value?.uid,
      // }).key;
      // if (editKey) {
      //   push(
      //     dbRef(db, `user/${user.value?.uid}/suggestions/edit/${entity}`),
      //     keyRef,
      //   );
      // } else {
      //   push(
      //     dbRef(db, `user/${user.value?.uid}/suggestions/add/${entity}`),
      //     keyRef,
      //   );
      // }
      // return { key: keyRef };
      return {}
    }

    return { entities, submit };
  });
}
