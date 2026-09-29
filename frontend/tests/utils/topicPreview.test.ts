import { describe, it, expect } from "vitest";
import { topicPreview } from "../../app/utils/topicPreview";

const proposal = (data: Record<string, unknown>, nodeId = "bb") => ({
  node_id: nodeId,
  data,
});

describe("topicPreview", () => {
  it("shows the name and the lead a proposal would leave", () => {
    // What a reader following „Podgląd tej wersji” came to see: their own
    // wording, in place of what the page says now.
    expect(
      topicPreview(
        "bb",
        proposal({
          type: "topic",
          name: "Bielsko-Biała",
          description:
            "Przykłady koryciarstwa w Bielsku-Białej od lipca 2026 roku",
        }),
      ),
    ).toEqual({
      name: "Bielsko-Biała",
      description: "Przykłady koryciarstwa w Bielsku-Białej od lipca 2026 roku",
    });
  });

  it("shows a lead the proposal took away as gone", () => {
    expect(
      topicPreview("bb", proposal({ type: "topic", name: "Bielsko-Biała" })),
    ).toEqual({ name: "Bielsko-Biała", description: undefined });
  });

  it("reads the older spelling of the target", () => {
    expect(
      topicPreview("bb", { nodeId: "bb", data: { name: "Kolej" } }),
    ).toMatchObject({ name: "Kolej" });
  });

  it("does not draw another page's proposal over this one", () => {
    expect(
      topicPreview("bb", proposal({ name: "Orlen" }, "orlen")),
    ).toBeUndefined();
  });

  it("has nothing to show without a revision", () => {
    expect(topicPreview("bb", null)).toBeUndefined();
    expect(topicPreview("bb", undefined)).toBeUndefined();
  });
});
