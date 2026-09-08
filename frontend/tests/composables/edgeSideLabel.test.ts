import { describe, it, expect } from "vitest";
import { edgeSideLabel } from "../../app/composables/edges";

describe("edgeSideLabel", () => {
  it("prints the stored word on the source's page and its reverse on the target's", () => {
    // The whole bug: one word printed at both ends said Anna was Jan's wife
    // and, on her page, that he was too.
    const edge = {
      type: "connection" as const,
      name: "żona",
      reverse_name: "mąż",
    };

    expect(edgeSideLabel(edge, "outgoing")).toBe("żona");
    expect(edgeSideLabel(edge, "incoming")).toBe("mąż");
  });

  it("falls back to the one word a relation written before the field has", () => {
    // The old behaviour, kept on purpose: it is wrong on one of the two pages,
    // but "Powiązanie z" in its place would lose the only thing anybody typed.
    // /admin/relacje is what works these off.
    const edge = { type: "connection" as const, name: "żona" };

    expect(edgeSideLabel(edge, "outgoing")).toBe("żona");
    expect(edgeSideLabel(edge, "incoming")).toBe("żona");
  });

  it("reads an employment the same way from either end", () => {
    // Only a `connection` stores a second word; a job title is a job title on
    // the person's page and on the company's.
    const edge = { type: "employed" as const, name: "prezes zarządu" };

    expect(edgeSideLabel(edge, "outgoing")).toBe("prezes zarządu");
    expect(edgeSideLabel(edge, "incoming")).toBe("prezes zarządu");
  });

  it("uses the type's Polish phrase where the relation has no word at all", () => {
    expect(edgeSideLabel({ type: "employed" }, "incoming")).toBe(
      "Zatrudniony/a w",
    );
    expect(edgeSideLabel({ type: "connection" }, "incoming")).toBe(
      "Powiązanie z",
    );
  });
});
