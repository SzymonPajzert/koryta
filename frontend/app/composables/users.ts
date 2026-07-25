import { authRequest } from "./auth";

export type LookedUpUser = {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

// Uids queued for the next lookup request. Module level so that many
// components rendering in the same tick share a single batched request.
const pending = new Set<string>();
let flushScheduled = false;

/** Resolve user ids to display names via the admin-only lookup endpoint.
 *
 * Results are cached for the session; uids the caller may not resolve (or
 * that don't exist) are cached as `null` so we don't retry them. */
export function useUserLookup() {
  const cache = useState<Record<string, LookedUpUser | null>>(
    "user-lookup",
    () => ({}),
  );

  const flush = async () => {
    flushScheduled = false;
    const uids = [...pending];
    pending.clear();
    if (uids.length === 0) return;

    try {
      const res = await authRequest<{
        users: Record<string, LookedUpUser>;
      }>(`/api/users/lookup?uids=${encodeURIComponent(uids.join(","))}`, {
        method: "GET",
      });
      for (const uid of uids) {
        cache.value[uid] = res.users[uid] ?? null;
      }
    } catch (err) {
      // Non-admins get a 403 - fall back to showing raw uids.
      console.debug("User lookup failed:", err);
      for (const uid of uids) {
        if (!(uid in cache.value)) cache.value[uid] = null;
      }
    }
  };

  const resolve = (uids: (string | null | undefined)[]) => {
    if (import.meta.server) return;
    for (const uid of uids) {
      if (!uid || uid in cache.value || pending.has(uid)) continue;
      pending.add(uid);
    }
    if (pending.size > 0 && !flushScheduled) {
      flushScheduled = true;
      setTimeout(flush, 50);
    }
  };

  const displayName = (uid?: string | null): string => {
    if (!uid) return "Nieznany";
    const info = cache.value[uid];
    return info?.displayName || info?.email || uid;
  };

  return { cache, resolve, displayName };
}
