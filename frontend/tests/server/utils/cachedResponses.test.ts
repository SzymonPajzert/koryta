import { beforeEach, describe, expect, it } from "vitest";
import { createStorage, prefixStorage, type Storage } from "unstorage";
import { dropCachedResponses } from "../../../server/utils/cachedResponses";

/** The storage as production has it: one root memory driver, the cache's
 * entries keys inside it. */
let storage: Storage;

beforeEach(async () => {
  storage = createStorage({});
  globalThis.useStorage = ((base: string) =>
    prefixStorage(storage, base)) as unknown as typeof globalThis.useStorage;
  await storage.setItem("cache:nitro:handlers:_:apistatsregions.a.json", 1);
  await storage.setItem("cache:nitro:routes:_:index.b.json", 1);
  await storage.setItem("cache:nitro:functions:milestones.c.json", 1);
});

describe("dropCachedResponses", () => {
  it("drops what clear(base) leaves behind", async () => {
    // Why the helper exists: unstorage clears mounts, not keys in one.
    await prefixStorage(storage, "cache").clear("nitro:handlers");
    expect(await storage.getKeys("cache:nitro:handlers")).toHaveLength(1);

    await dropCachedResponses("nitro:handlers", "nitro:routes");

    expect(await storage.getKeys("cache")).toEqual([
      "cache:nitro:functions:milestones.c.json",
    ]);
  });
});
