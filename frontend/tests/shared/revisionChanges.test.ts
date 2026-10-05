import { describe, it, expect } from "vitest";
import {
  proposableFieldNames,
  renderFieldValue,
  revisionChanges,
  revisionFieldLabels,
} from "../../shared/revisionChanges";

/** A person node as the target reads today. */
const stored = {
  type: "person",
  name: "Jan Kowalski",
  content: "Poseł.",
  parties: ["PiS", "PO"],
  birthDate: "1970-01-01",
  isPublic: false,
};

describe("revisionChanges", () => {
  it("reports nothing when the snapshot only restates the entry", () => {
    // The whole point: a revision carries a complete copy of its target, so
    // the usual case is that every field it names is the field already there.
    expect(revisionChanges({ ...stored }, stored)).toEqual([]);
  });

  it("names a changed field in Polish and renders both sides", () => {
    expect(revisionChanges({ ...stored, content: "Senator." }, stored)).toEqual(
      [{ field: "content", label: "opis", from: "Poseł.", to: "Senator." }],
    );
  });

  it("renders a changed flag as tak or nie", () => {
    expect(revisionChanges({ isPublic: true }, stored)).toEqual([
      {
        field: "isPublic",
        label: "w rękach publicznych",
        from: "nie",
        to: "tak",
      },
    ]);
  });

  it("does not read an omitted field as a proposal to delete it", () => {
    // The ingest endpoints write whatever the scrapers found, which is rarely
    // the whole document; only what a proposal states is a claim about it.
    expect(revisionChanges({ name: "Jan Kowalski" }, stored)).toEqual([]);
    expect(revisionChanges({ content: "Senator." }, stored)).toHaveLength(1);
  });

  it("reports a win taken back, which the proposal says by leaving it out", () => {
    // `elected` is stored for a win and never as `false`, so a correction that
    // unticks „Uzyskano mandat” reaches the queue with no key at all - and
    // approving it, a `set`, deletes the win. Skipped as an omission, the
    // reviewer saw an empty proposal whose approval removed a claim about a
    // named person.
    const candidacy = { type: "election", position: "Senat", elected: true };
    const { elected: _won, ...unticked } = candidacy;

    expect(revisionChanges(unticked, candidacy)).toEqual([
      { field: "elected", label: "wybrany", from: "tak", to: null },
    ]);
    // A stored `false` reads as a blank everywhere (see `elected` in
    // shared/api.ts), so dropping one is not a change anybody has to decide on.
    expect(revisionChanges(unticked, { ...candidacy, elected: false })).toEqual(
      [],
    );
  });

  it("tells a field that was never there from one holding an empty value", () => {
    expect(
      revisionChanges({ wikipedia: "https://pl.wikipedia.org/wiki/X" }, stored),
    ).toEqual([
      {
        field: "wikipedia",
        label: "Wikipedia",
        from: null,
        to: "https://pl.wikipedia.org/wiki/X",
      },
    ]);

    // Stored as empty is a value somebody wrote, not an absence.
    expect(
      revisionChanges({ ktomaco: "abc" }, { ...stored, ktomaco: "" })[0]?.from,
    ).toBe("");

    // And clearing a field is a change to "", not to nothing.
    expect(revisionChanges({ content: "" }, stored)).toEqual([
      { field: "content", label: "opis", from: "Poseł.", to: "" },
    ]);
  });

  it("reads an index-keyed map as the array it stands for", () => {
    // Until 2026-07-28 `sanitizeFirestoreData` rewrote every array into a map
    // keyed by index, and it still does for a nested one, so a stored revision
    // carries `parties` in that shape while the node carries a real array.
    // Comparing them by identity would show every array field as changed.
    expect(
      revisionChanges({ parties: { "0": "PiS", "1": "PO" } }, stored),
    ).toEqual([]);
  });

  it("never reports the fields that say what a document is", () => {
    // An edge restates its own endpoints in every revision, and a removal is
    // rendered as its own thing rather than as `deleted: — → tak`.
    const changes = revisionChanges(
      {
        type: "place",
        source: "nodes/a",
        target: "nodes/b",
        isPublicSource: "uid-2",
        deleted: true,
        delete_reason: "duplikat",
        name: "Jan Nowak",
      },
      { ...stored, isPublicSource: "uid-1" },
    );

    expect(changes.map((change) => change.field)).toEqual(["name"]);
  });

  it("orders the changes by their Polish label", () => {
    // Firestore does not promise a key order, so without this the same
    // proposal reads differently from one load to the next.
    const changes = revisionChanges(
      { name: "Jan Nowak", content: "Senator.", birthDate: "1971-02-02" },
      stored,
    );

    expect(changes.map((change) => change.label)).toEqual([
      "data urodzenia",
      "nazwa",
      "opis",
    ]);
  });

  it("shows every field of a brand new entry", () => {
    const changes = revisionChanges(
      { name: "Nowa osoba", content: "Opis." },
      {},
    );
    expect(changes.map((change) => [change.field, change.from])).toEqual([
      ["name", null],
      ["content", null],
    ]);
  });

  it("does not report a field the entry never had, stated empty", () => {
    // The edit dialog posts every optional field of its form, so a proposal
    // that only fixes a misspelt name still says `birthDate: ""` for a person
    // the pipeline created without one. Rendering that as "— → usunięto"
    // buries the one line that matters under four that say nothing.
    const changes = revisionChanges(
      { name: "Anna Nowak", birthDate: "", wikipedia: "" },
      { name: "Ana Nowak" },
    );
    expect(changes.map((change) => change.field)).toEqual(["name"]);
  });

  it("still reports a field that was stored and is being cleared", () => {
    const changes = revisionChanges(
      { birthDate: "" },
      { birthDate: "1970-01-01" },
    );
    expect(changes).toEqual([
      {
        field: "birthDate",
        label: "data urodzenia",
        from: "1970-01-01",
        to: "",
      },
    ]);
  });
});

describe("renderFieldValue", () => {
  it("renders a flag as a Polish yes or no", () => {
    expect(renderFieldValue(true)).toBe("tak");
    expect(renderFieldValue(false)).toBe("nie");
  });

  it("joins a list into one readable line, whichever shape it arrives in", () => {
    expect(renderFieldValue(["PiS", "PO"])).toBe("PiS, PO");
    expect(renderFieldValue({ "0": "PiS", "1": "PO" })).toBe("PiS, PO");
    // The index is a number, not a string: item 10 belongs after item 2.
    expect(renderFieldValue({ "10": "z", "2": "b" })).toBe("b, z");
  });

  it("tells an absent value from an empty one", () => {
    expect(renderFieldValue(undefined)).toBeNull();
    expect(renderFieldValue(null)).toBeNull();
    expect(renderFieldValue("")).toBe("");
    expect(renderFieldValue([])).toBe("");
  });
});

describe("revisionFieldLabels", () => {
  it("labels every field a reader can edit", () => {
    // A field added to `editSchemas` without a label here ships as a bare
    // English key in the middle of Polish copy.
    const missing = proposableFieldNames().filter(
      (field) => !(field in revisionFieldLabels),
    );

    expect(
      missing,
      `no Polish label in revisionFieldLabels for: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
