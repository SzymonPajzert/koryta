import { describe, it, expect, vi } from "vitest";
import { dropDraftStats } from "../../../server/utils/fetch";

// Hoisted above the import: fetch.ts defines its cached functions at load.
vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = (fn: any) => fn;
});

describe("dropDraftStats", () => {
  it("does not count the województwo markers as hidden ties", () => {
    const node = {
      name: "Anna Nowak",
      stats: {
        edges: {
          all: {
            targetNodeIds: ["teryt1465", "teryt1261", "woj:14", "woj:12"],
          },
          approved: { targetNodeIds: ["teryt1465", "woj:14"] },
        },
      },
    };

    const shown = dropDraftStats(node);

    expect(shown.stats.edges).toEqual({
      approved: { targetNodeIds: ["teryt1465", "woj:14"] },
      hiddenTargets: 1,
    });
    // The cached original is left as it was.
    expect(node.stats.edges).toHaveProperty("all");
  });

  it("reads arrays stored as maps the same way", () => {
    const shown = dropDraftStats({
      stats: {
        edges: {
          all: { targetNodeIds: { 0: "teryt1261", 1: "woj:12" } },
          approved: { targetNodeIds: [] },
        },
      },
    });
    expect(shown.stats.edges).toMatchObject({ hiddenTargets: 1 });
  });
});
