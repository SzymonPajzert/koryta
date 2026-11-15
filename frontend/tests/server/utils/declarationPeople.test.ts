import { describe, it, expect, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  PEOPLE_DOC,
  readDeclarationPeople,
} from "../../../server/utils/declarationPeople";
import { SEEDED_DECLARATION_PEOPLE as seeded } from "../../../scripts/declarationPeople";

/** A Firestore with one document in `stats`, or none. */
function fakeDb(doc: Record<string, unknown> | null) {
  const read = vi.fn((collection: string, id: string) => {
    expect(collection).toBe("stats");
    expect(id).toBe(PEOPLE_DOC);
    return { exists: doc !== null, data: () => doc ?? undefined };
  });
  const db = {
    collection: (collection: string) => ({
      doc: (id: string) => ({ get: async () => read(collection, id) }),
    }),
  } as unknown as Firestore;
  return { db, read };
}

describe("readDeclarationPeople", () => {
  it("is null before the job's first night", async () => {
    expect(await readDeclarationPeople(fakeDb(null).db)).toBeNull();
  });

  it("reads the night's snapshot", async () => {
    const people = await readDeclarationPeople(fakeDb(seeded).db);
    expect(people?.published).toBe(seeded.published);
    expect(people?.people).toBe(seeded.people);
  });

  it("says nothing of a document that does not read as a snapshot", async () => {
    // An old shape, or a job that wrote half of one: left unsaid rather than
    // half drawn.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await readDeclarationPeople(fakeDb({ ...seeded, people: 1 }).db),
    ).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
