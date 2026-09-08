import { authRequest } from "~/composables/auth";
// Type-only, so nothing of the server util - zod included - reaches the bundle.
import type { ScannedEdges } from "~~/server/utils/edgeScan";

/** The reading half of an admin queue backed by a scanning endpoint.
 *
 * Two of the admin tables are the same page in different clothes: fetch a
 * screenful, show how many documents that cost, offer "Wczytaj więcej" while
 * a cursor comes back, and re-read rather than patch after a write. Only what
 * the rows *are* differs, so only that stays in the page.
 *
 * @param path the endpoint, which must answer with `ScannedEdges`.
 * @param limit how many rows a screenful is.
 */
export function useScannedQueue<Row>(path: string, limit = 50) {
  const rows = ref<Row[]>([]) as Ref<Row[]>;
  const nextCursor = ref<string | null>(null);
  const scanned = ref(0);
  const truncated = ref(false);
  const pending = ref(false);
  const error = ref<string | null>(null);

  /** @param more whether to append the next page rather than start over. */
  async function load(more = false) {
    // These endpoints only answer a caller carrying an admin token, which the
    // server render has no way to present - it would spend a request on a 401.
    if (import.meta.server) return;

    pending.value = true;
    error.value = null;
    try {
      const data = await authRequest<ScannedEdges<Row>>(path, {
        method: "GET",
        query: {
          limit,
          ...(more && nextCursor.value ? { cursor: nextCursor.value } : {}),
        },
      });
      rows.value = more ? [...rows.value, ...data.edges] : data.edges;
      nextCursor.value = data.nextCursor;
      scanned.value = more ? scanned.value + data.scanned : data.scanned;
      truncated.value = data.truncated;
    } catch (err) {
      error.value =
        (err as { data?: { message?: string } }).data?.message ||
        "Nie udało się wczytać powiązań.";
    } finally {
      pending.value = false;
    }
  }

  return { rows, nextCursor, scanned, truncated, pending, error, load };
}
