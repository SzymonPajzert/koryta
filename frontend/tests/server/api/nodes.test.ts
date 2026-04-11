import { describe, it, expect } from "vitest";
import { fetchNodes } from "../../../server/utils/fetch";
import { setup } from "@nuxt/test-utils/e2e";

describe("fetchNodes", async () => {
  await setup({
    // test context options
  });

  it("should fetch all nodes when no filters are provided", async () => {
    const results = await fetchNodes("person");
    expect(results).toBeDefined();
    expect(Object.keys(results).length).toBeGreaterThan(0);
  });
});

describe("createNode", () => {
  it("placeholder for creation test", () => {
    expect(true).toBe(true);
  });
});
