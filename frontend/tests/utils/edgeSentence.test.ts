import { describe, it, expect } from "vitest";
import { edgeSentence } from "../../app/utils/edgeSentence";
import type { EdgeNode } from "../../app/composables/edges";

function edge(fields: Partial<EdgeNode> = {}): EdgeNode {
  return {
    id: "e1",
    type: "employed",
    label: "Zatrudniony/a w",
    source: "p1",
    target: "c1",
    richNode: { id: "c1", type: "place", name: "Orlen" },
    ...fields,
  } as EdgeNode;
}

describe("edgeSentence", () => {
  it("reads as who, which relation, with whom, and when", () => {
    expect(
      edgeSentence(
        "Jan Kowalski",
        edge({ start_date: "2023-04-01", end_date: "2024-09-30" }),
      ),
    ).toBe("Jan Kowalski - Zatrudniony/a w - Orlen · 2023-04-01 - 2024-09-30");
  });

  it("names the subject the reader is looking at, not the edge's source", () => {
    // The same edge, read from the company's page. Without this the removal
    // dialog on /instytucja would open saying the company's own name twice.
    expect(
      edgeSentence(
        "Orlen",
        edge({
          richNode: { id: "p1", type: "person", name: "Jan Kowalski" },
        } as Partial<EdgeNode>),
      ),
    ).toBe("Orlen - Zatrudniony/a w - Jan Kowalski");
  });

  it("drops the period rather than trailing a separator", () => {
    // A `connection` has no date fields in the schema, and most of the drawer's
    // rows are undated.
    expect(edgeSentence("Jan Kowalski", edge())).toBe(
      "Jan Kowalski - Zatrudniony/a w - Orlen",
    );
  });

  it("reads a half-open period the way every relation's period reads", () => {
    // Through `relationPeriodLabel`: a post with no end is still held, so the
    // dialog says „obecnie” as the row it was opened from does.
    expect(edgeSentence("Jan", edge({ start_date: "2020-01-01" }))).toBe(
      "Jan - Zatrudniony/a w - Orlen · 2020-01-01 - obecnie",
    );
  });

  it("is empty for no edge, so a dialog that has not been opened renders nothing", () => {
    expect(edgeSentence("Jan Kowalski", undefined)).toBe("");
  });
});
