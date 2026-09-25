import type { Storage } from "unstorage";

/** Dropping cached responses after a write.
 *
 * Not `useStorage("cache").clear("nitro:handlers")`, which the editors' write
 * paths call and which never removes a thing. unstorage's
 * `clear(base)` only visits the mounts that sit *under* `base`, and there are
 * none: the cache lives on the `cache:` mount in development (a directory under
 * .nuxt/cache) and on the root memory mount in production, both above
 * `cache:nitro:handlers:`, so no driver was ever called. `getKeys` does walk
 * the parent mount, which is why these list the keys under a prefix and remove
 * them one at a time.
 *
 * The editors' write paths (edges, nodes, revisions, person ingest) still call
 * `clear()`. Making their purge real would also drop the expensive aggregates
 * (`stats-database`) on every edit, which changes what the site pays in reads,
 * so that is a separate decision from this file.
 *
 * What a purge reaches is this process's storage. In production that is the
 * memory of the one instance that took the write, and a CDN copy of a response
 * (`s-maxage`) is out of reach entirely - a purge shortens how long a stale
 * answer is served, it does not promise the next request anywhere sees the
 * write.
 */

type CacheStorage = Pick<Storage, "getKeys" | "removeItem">;

/** Removes every cached entry under `base` (relative to `useStorage("cache")`)
 * that `match` accepts, and says how many there were. */
export async function purgeCache(
  base: string,
  options: { match?: (key: string) => boolean; storage?: CacheStorage } = {},
): Promise<number> {
  const storage = options.storage ?? useStorage("cache");
  const keys = await storage.getKeys(base);
  const doomed = options.match ? keys.filter(options.match) : keys;
  await Promise.all(doomed.map((key) => storage.removeItem(key)));
  return doomed.length;
}

/** Every cached API response - `defineCachedEventHandler` and the wrappers in
 * `handlers.ts` - which is what the write paths mean by "the cache". */
export function purgeHandlerCache(storage?: CacheStorage): Promise<number> {
  return purgeCache("nitro:handlers", { storage });
}

/** A route cache key starts with the path stripped of non-word characters and
 * cut to 16 (nitro's `escapeKey`): `eksplorujumowy.<hash>` for the html,
 * `eksplorujumowy_p.<hash>` for its `_payload.json`. */
const CONTRACT_LINK_ROUTE_KEY = /(^|:)eksplorujumowy/;

/** The findings' own handlers: `contract-links` (the list) and
 * `contract-link` (one finding). */
const CONTRACT_LINK_HANDLER_KEY = /^nitro:handlers:contract-links?:/;

/** For a change to the findings or to the contracts behind them: their cached
 * API responses, and the rendered /eksploruj/umowy (`swr: 60` in
 * nuxt.config.ts) with its `_payload.json`, both of which embed the list as it
 * was before the write. A finding taken back behind the login has to stop
 * being named there as well. Nothing else: no other response reads
 * `contractLinks` or `contractLinkContracts`. */
export async function purgeContractLinkCaches(
  storage?: CacheStorage,
): Promise<number> {
  const [handlers, routes] = await Promise.all([
    purgeCache("nitro:handlers", {
      storage,
      match: (key) => CONTRACT_LINK_HANDLER_KEY.test(key),
    }),
    purgeCache("nitro:routes", {
      storage,
      match: (key) => CONTRACT_LINK_ROUTE_KEY.test(key),
    }),
  ]);
  return handlers + routes;
}
