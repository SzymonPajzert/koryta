import { describe, expect, it } from "vitest";
import { createStorage, prefixStorage, type Storage } from "unstorage";
import memory from "unstorage/drivers/memory";
import {
  purgeContractLinkCaches,
  purgeHandlerCache,
} from "../../../server/utils/cache";

/** Keys as nitro writes them: `<group>:<name>:<path, 16 chars>.<hash>.json`
 * under the `cache:` base (runtime/internal/cache.mjs). */
const HANDLER_LIST = "nitro:handlers:contract-links:apicontractspowi.Ab12.json";
const HANDLER_DETAIL =
  "nitro:handlers:contract-link:apicontractspowi.Cd34.json";
const HANDLER_OTHER =
  "nitro:handlers:stats-database:apistatsdatabase.Ef56.json";
const ROUTE_PAGE = "nitro:routes:_:eksplorujumowy.Gh78.json";
const ROUTE_PAYLOAD = "nitro:routes:_:eksplorujumowy_p.Ij90.json";
const ROUTE_HOME = "nitro:routes:_:index.Kl12.json";
const ROUTE_HOME_PAYLOAD = "nitro:routes:_:_payloadjson.Mn34.json";
const FUNCTION = "nitro:functions:_:something.json";

const ALL = [
  HANDLER_LIST,
  HANDLER_DETAIL,
  HANDLER_OTHER,
  ROUTE_PAGE,
  ROUTE_PAYLOAD,
  ROUTE_HOME,
  ROUTE_HOME_PAYLOAD,
  FUNCTION,
];

/** `useStorage("cache")` as nitro builds it: a prefix over one storage.
 * Production has only the root memory mount; development mounts a directory
 * at `cache:`. Either way nothing is mounted *below* `cache:nitro:handlers:`,
 * which is what made `clear()` a no-op. */
async function cacheStorage(mountCache: boolean): Promise<Storage> {
  const root = createStorage();
  if (mountCache) root.mount("cache", memory());
  const cache = prefixStorage(root, "cache");
  for (const key of ALL) await cache.setItem(key, { value: key });
  return cache;
}

describe.each([
  ["a single root mount (production)", false],
  ["a mount at cache: (development)", true],
])("the cache purge, on %s", (_label, mountCache) => {
  it("is needed: unstorage's clear() below the only mount removes nothing", async () => {
    const cache = await cacheStorage(mountCache);
    await cache.clear("nitro:handlers");
    expect(await cache.getKeys("nitro:handlers")).toHaveLength(3);
  });

  it("removes every cached handler and nothing else", async () => {
    const cache = await cacheStorage(mountCache);

    expect(await purgeHandlerCache(cache)).toBe(3);

    expect(await cache.getKeys("nitro:handlers")).toEqual([]);
    expect((await cache.getKeys()).sort()).toEqual(
      [
        ROUTE_PAGE,
        ROUTE_PAYLOAD,
        ROUTE_HOME,
        ROUTE_HOME_PAYLOAD,
        FUNCTION,
      ].sort(),
    );
  });

  it("removes, for the findings, their handlers and the rendered page with its payload", async () => {
    const cache = await cacheStorage(mountCache);

    expect(await purgeContractLinkCaches(cache)).toBe(4);

    expect((await cache.getKeys()).sort()).toEqual(
      [HANDLER_OTHER, ROUTE_HOME, ROUTE_HOME_PAYLOAD, FUNCTION].sort(),
    );
    expect(await cache.hasItem(ROUTE_PAGE)).toBe(false);
    expect(await cache.hasItem(ROUTE_PAYLOAD)).toBe(false);
  });
});
