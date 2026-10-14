import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, type Ref } from "vue";
import { useNotes } from "../../app/composables/notes";

/** The query `useNotes` hands to vuefire, as the reader would have it run. */
const subscribed = vi.hoisted(() => ({ query: undefined as unknown }));
const user: Ref<{ uid: string } | null> = ref(null);

vi.mock("vuefire", () => ({
  useFirebaseApp: () => ({}),
  useCollection: (source: { value: unknown }) => {
    subscribed.query = source;
    return ref([]);
  },
}));
vi.mock("firebase/firestore", () => ({
  getFirestore: () => ({}),
  collection: (_db: unknown, name: string) => ({ name }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (from: unknown, ...clauses: unknown[]) => ({ from, clauses }),
  doc: vi.fn(),
  setDoc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
}));
vi.mock("../../app/composables/auth", () => ({
  useAuthState: () => ({ user }),
}));

/** What the subscription currently asks Firestore for. */
const asked = () => (subscribed.query as { value: unknown }).value;

describe("useNotes", () => {
  beforeEach(() => {
    user.value = null;
    subscribed.query = undefined;
  });

  it("does not ask for a person's notes for a logged out reader", () => {
    // firestore.rules keeps them to signed in readers, so the query would only
    // be refused - a console error on every person's page.
    useNotes("person-1", "person");
    expect(asked()).toBeNull();
  });

  it("asks once the reader signs in", () => {
    useNotes("person-1", "person");
    user.value = { uid: "reader" };
    expect(asked()).toMatchObject({
      clauses: [{ field: "nodeId", op: "==", value: "person-1" }],
    });
  });

  it("asks for a company's notes whoever is reading", () => {
    useNotes("company-1", "place");
    expect(asked()).toMatchObject({
      clauses: [{ field: "nodeId", op: "==", value: "company-1" }],
    });
  });
});
