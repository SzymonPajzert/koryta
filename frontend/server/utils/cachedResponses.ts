/** Drops every cached response under these bases of the `cache` storage, e.g.
 * `nitro:handlers` (the cached API handlers) and `nitro:routes` (pages with a
 * `swr` route rule, the home page).
 *
 * Key by key, because `clear(base)` drops nothing here: unstorage clears whole
 * mounts at or below a base, and these entries are keys inside one mount, the
 * root in production and `cache` in dev. */
export async function dropCachedResponses(...bases: string[]): Promise<void> {
  const cache = useStorage("cache");
  for (const base of bases) {
    const keys = await cache.getKeys(base);
    await Promise.all(keys.map((key) => cache.removeItem(key)));
  }
}
