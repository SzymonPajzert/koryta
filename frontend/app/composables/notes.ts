import { computed, type MaybeRef } from "vue";
import {
  getFirestore,
  doc,
  setDoc,
  where,
  collection,
  query,
} from "firebase/firestore";
import { useCollection, useFirebaseApp } from "vuefire";
import { useAuthState } from "./auth";
import type { Note } from "~~/shared/model";

export function useNotes(nodeID: MaybeRef<string>) {
  const { user } = useAuthState();
  const firebaseApp = useFirebaseApp();
  const db = getFirestore(firebaseApp, "koryta-pl");

  const nodeRef = computed(() => toValue(nodeID));

  const notesQuery = computed(() => {
    return query(collection(db, "notes"), where("nodeId", "==", nodeRef.value));
  });

  const allNotes = useCollection<Note>(notesQuery, { wait: true });

  const userNote = computed(() => {
    if (!user.value) return null;
    return allNotes.value.find((n) => n.userUid === user.value?.uid) || null;
  });

  const otherNotes = computed(() => {
    if (!user.value) return allNotes.value;
    return allNotes.value.filter((n) => n.userUid !== user.value?.uid);
  });

  const saveNote = async (data: Partial<Note>) => {
    if (!user.value) throw new Error("User must be logged in");
    const docId = `${nodeRef.value}_${user.value.uid}`;
    const dataTyped: Note = {
      ...data,
      userUid: user.value.uid,
      nodeId: nodeRef.value,
    };
    await setDoc(doc(db, "notes", docId), dataTyped, {
      merge: true,
    });
  };

  return {
    userNote,
    // TODO enable users seeing other users nodes
    otherNotes,
    saveNote,
  };
}
