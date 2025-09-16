import { useCollection } from 'vuefire'
import { collection, query, where, getFirestore } from 'firebase/firestore'
import type { DestinationTypeMap, Destination } from "@/../shared/model";
// import { useAuthState } from "@/composables/auth";
import { defineStore } from "pinia";
import { destinationToNodeType } from '@/../shared/model';

export function createEntityStore<D extends Destination>(entity: D) {
  return defineStore("entity_" + entity, () => {
    const db = getFirestore(useFirebaseApp(), "koryta-pl");

    type T = DestinationTypeMap[D];

    const location = destinationToNodeType[entity];
    const entitiesApproved = useCollection(query(
      collection(db, "nodes"),
      where("type", "==", location)))
    const entities = computed(() =>
      Object.fromEntries(entitiesApproved.value.map(e => [e.id, e] as [string, T])));

    function submit<D extends Destination>(
      _value: DestinationTypeMap[D],
      _d: D,
      _editKey: string | undefined,
    ) {
      return {}
    }

    return { entities, submit };
  });
}
