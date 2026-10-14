import { describe, it, expect, vi } from "vitest";
import {
  documentId,
  isDocumentId,
  requireDocumentId,
} from "~~/server/utils/documentId";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
});

describe("isDocumentId", () => {
  it.each([
    "teryt1263",
    "edge_teryt1263_elzat_seat",
    "Twm20atuwEHkzrNq8hMe",
    "osoba-bez-pesel.2",
    "__half",
    "_x_",
  ])("takes %j", (id) => {
    expect(isDocumentId(id)).toBe(true);
  });

  it.each([
    // `collection("nodes").doc("x/y/z")` is `nodes/x/y/z`: a document below
    // node `x`, whose `.id` is `z`.
    ["x/y/z", "a path to a document below a node"],
    ["x/y", "a path to a collection, which `.doc()` throws on"],
    ["x/", "a trailing slash, which `.doc()` drops without a word"],
    ["/x", "a leading slash"],
    [".", "the current directory"],
    ["..", "the parent"],
    ["__name__", "a reserved id"],
    ["", "nothing"],
  ])("refuses %j, %s", (id) => {
    expect(isDocumentId(id)).toBe(false);
  });

  it.each([undefined, null, 5, ["teryt1263"], { id: "teryt1263" }])(
    "refuses %j, which is not a string",
    (id) => {
      expect(isDocumentId(id)).toBe(false);
    },
  );

  it("counts Firestore's 1500 in bytes, not characters", () => {
    // "ł" is two bytes in UTF-8.
    expect(isDocumentId("ł".repeat(750))).toBe(true);
    expect(isDocumentId("ł".repeat(751))).toBe(false);
  });
});

describe("documentId", () => {
  it("fails the schema it is part of", () => {
    expect(documentId.safeParse("teryt1263").success).toBe(true);
    expect(documentId.safeParse("teryt1263/x/y").success).toBe(false);
  });
});

describe("requireDocumentId", () => {
  it("hands an id back", () => {
    expect(requireDocumentId("teryt1263", "node_id")).toBe("teryt1263");
  });

  it("answers anything else with a 400 that names the field", () => {
    expect(() => requireDocumentId("x/y/z", "node_id")).toThrow(
      expect.objectContaining({
        statusCode: 400,
        message: expect.stringContaining("node_id"),
      }),
    );
  });
});
