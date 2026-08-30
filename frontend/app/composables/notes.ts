import { computed, type MaybeRef } from "vue";
import {
  getFirestore,
  doc,
  setDoc,
  where,
  collection,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { useCollection, useFirebaseApp } from "vuefire";
import {
  mdiAlertCircleOutline,
  mdiDotsHorizontalCircleOutline,
  mdiLightbulbOnOutline,
  mdiLinkVariant,
  mdiPencilOutline,
  mdiHelpCircleOutline,
  mdiVectorLink,
} from "@mdi/js";
import { useAuthState } from "./auth";
import { withArticleIds } from "~/utils/notePromotion";
import type { Note, NoteEntryKind, NoteSource } from "~~/shared/model";

/** How each note entry kind presents itself: the label on its chip, the button
 * that creates one, the prompt above the text area - and one written note of
 * that kind, as an example.
 *
 * The example is not decoration. „Nie wiadomo trochę, jakie info tam wklejać”
 * is how an alpha tester put it, and a prompt phrased as a question does not
 * answer it: „Co ciekawego jest w tym źródle?” tells somebody they should type
 * something without telling them what a useful something looks like. One filled
 * in note does, in less space than a paragraph of instructions would.
 */
export const noteKindConfig: Record<
  NoteEntryKind,
  {
    title: string;
    addLabel: string;
    prompt: string;
    /** A note of this kind, written out. Stored without the „np.” that a
     * placeholder wants in front of it, so the same sentence can also be listed
     * as an example above the form. */
    example: string;
    icon: string;
    color: string;
  }
> = {
  source: {
    title: "Źródło",
    addLabel: "Dodaj źródło",
    prompt: "Co ciekawego jest w tym źródle?",
    example:
      "Artykuł z marca 2023: został prezesem dwa miesiące po wyborach, " +
      "wcześniej prowadził kampanię wójta. Link niżej.",
    icon: mdiLinkVariant,
    color: "primary",
  },
  change_request: {
    title: "Do poprawy",
    addLabel: "Zgłoś poprawkę",
    prompt: "Co jest nie tak i jak powinno być?",
    example:
      "To imiennik - w radzie nadzorczej siedzi inny Jan Kowalski. Radny z " +
      "Radomia to osobna osoba.",
    icon: mdiPencilOutline,
    color: "warning",
  },
  missing: {
    title: "Brakuje danych",
    addLabel: "Zgłoś brak",
    prompt: "Czego tu brakuje?",
    example:
      "Brakuje pracy w spółce wodociągowej 2019-2021, widać ją w KRS pod " +
      "numerem 0000123456.",
    icon: mdiHelpCircleOutline,
    color: "info",
  },
};

/** Entries written before kinds existed are all sources.
 *
 * Defined in `shared/model.ts` beside the kind itself and re-exported here,
 * which is where every component already reaches for it. */
export { noteKindOf } from "~~/shared/model";

/** What an admin decided the entry is about, once they have read it - the kind
 * above is what its author said it was. Stored as a plain string, so a value
 * that predates this list still reads back; the order here is the order the
 * buttons appear in on /admin/notatki/kategoryzacja.
 */
export const noteAdminTypeConfig: Record<
  string,
  { title: string; hint: string; icon: string; color: string }
> = {
  missing_data: {
    title: "Brakujące dane / Błąd",
    hint: "Coś jest nie tak albo czegoś brakuje w danych.",
    icon: mdiAlertCircleOutline,
    color: "error",
  },
  new_connection: {
    title: "Nowe powiązanie",
    hint: "Wskazuje osobę, spółkę lub relację, której jeszcze nie ma.",
    icon: mdiVectorLink,
    color: "primary",
  },
  context: {
    title: "Ciekawostka / Kontekst",
    hint: "Tło sprawy - nie zmienia danych, ale warto je mieć.",
    icon: mdiLightbulbOnOutline,
    color: "info",
  },
  other: {
    title: "Inne",
    hint: "Nie pasuje do żadnej z powyższych.",
    icon: mdiDotsHorizontalCircleOutline,
    color: "grey",
  },
};

/** The stored value read back for display. An empty type is "Brak"; one this
 * build does not know is shown as itself rather than swallowed. */
export function noteAdminTypeLabel(type: string | null | undefined): string {
  if (!type) return "Brak";
  return noteAdminTypeConfig[type]?.title ?? type;
}

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
      // Stamped by firestore rather than by the browser, so a wrong clock on
      // one contributor's machine cannot pin their note to the top of the
      // admin queue forever. Reads normalise it back to an ISO string.
      updatedAt: serverTimestamp() as unknown as string,
    };
    // Only when there is no note yet, so coming back to one keeps the date it
    // was written. Should the note collection not have loaded when this runs,
    // the worst case is that an existing `createdAt` is moved forward - which
    // readers do not see, since `updatedAt` is written here too and takes
    // precedence over it.
    if (!userNote.value) {
      dataTyped.createdAt = serverTimestamp() as unknown as string;
    }
    await setDoc(doc(db, "notes", docId), dataTyped, {
      merge: true,
    });
  };

  /** Points the note's entries at the article nodes their urls became.
   *
   * A transaction, and it re-reads `sources` rather than being handed them,
   * because promoting is slow: it fetches every new url to read its title, and
   * an author who added another entry while that was in flight had it deleted
   * by this second write. `setDoc(..., {merge: true})` merges *fields*, and
   * `sources` is one field - so writing back the array as it looked before the
   * fetch replaces the whole of it. An admin verdict written in the same window
   * went the same way.
   *
   * Entries are matched by url, never by position, so an insert or a deletion
   * in the meantime attaches the ids to the right entries anyway.
   *
   * Writes nothing when nothing changed, which is what keeps a re-save of an
   * already promoted note from touching the document at all.
   */
  const attachArticleIds = async (articleIds: Map<string, string>) => {
    if (articleIds.size === 0) return;
    const docId = `${nodeRef.value}_${user.value?.uid}`;
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, "notes", docId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) return;
      const sources = (snapshot.data() as Note).sources ?? [];
      const updated = withArticleIds(sources, articleIds);
      if (!updated) return;
      // Only `sources`, so the timestamps and anything else the document holds
      // are left as they are - this is bookkeeping, not the author writing.
      transaction.update(ref, { sources: updated });
    });
  };

  return {
    userNote,
    // TODO enable users seeing other users nodes
    otherNotes,
    saveNote,
    attachArticleIds,
  };
}
