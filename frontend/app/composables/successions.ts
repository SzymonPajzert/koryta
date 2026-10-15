import { useCurrentUser } from "vuefire";
import { authFetch } from "~/composables/auth";
import type {
  CompanySuccessions,
  PersonSuccessions,
} from "~~/server/api/edges/successions.get";

/** Whose seat a person took, and who took theirs.
 *
 * Two things on a person's page want this: the "Wcześniej: …" line on each row
 * of the relation history, and the "Zmiany na stanowisku" section under it. A
 * composable rather than a fetch in each, because the two must not become two
 * requests - and because the explicit `useAsyncData` key that makes them one is
 * the sort of thing that drifts the moment it is written down twice.
 *
 * Not awaited by either caller. Nuxt settles `useAsyncData` before it
 * serialises the page, so the section is still server rendered; awaiting would
 * hold a client-side navigation into a profile on this one request.
 */
export function usePersonSuccessions(personId: string) {
  const route = useRoute();
  // `useCurrentUser` rather than `useAuthState`: all this needs is whether
  // somebody is signed in, and `useAuthState` also opens a Firestore
  // subscription to their user-config document - a read on every company and
  // person page for a flag it never looks at.
  const user = useCurrentUser();

  /** `latest` put in the query rather than left to `authFetch`.
   *
   * `authFetch` adds it in `onRequest`, and `onRequest` returns early on the
   * server - so the SSR request goes out anonymous, the redacted answer is
   * serialised into the payload, and `useFetch` does not run again on the
   * client because it already has data. A signed in reader kept being told
   * "nie pokazujemy jeszcze N zmian" about people they were perfectly entitled
   * to see. `useEdges` avoids this the same way: a reactive query, which
   * `useFetch` watches, so the request repeats once auth resolves in the
   * browser.
   *
   * The url is honoured too, which is what lets `?latest=true` preview the
   * unredacted answer without signing in.
   */
  const query = computed(() => ({
    personId,
    ...(user.value || route.query.latest !== undefined
      ? { latest: route.query.latest ?? true }
      : {}),
  }));

  return authFetch<PersonSuccessions>("/api/edges/successions", {
    query,
    // Named after the person rather than left to key on the call site: two
    // callers on one page must share one request, and two profiles must not
    // abort each other's.
    key: `person-successions-${personId}`,
  });
}

/** Who holds a post at a company now, and who took over from whom there.
 *
 * Called once, by the company's page, which hands the answer to the three
 * parts of `SuccessionCompanyChanges` it draws around the relation history. A
 * shared key does not make three callers one request: with `useFetch`'s
 * default `dedupe: "cancel"` each caller after the first aborts the request
 * before it and sends its own. `dedupe: "defer"` would join them, but it also
 * hands a refresh the request already in flight - the anonymous one, when the
 * reader signs in while it is still out.
 *
 * Not awaited, for the reason `usePersonSuccessions` gives; the query carries
 * `latest` for the same reason as there.
 */
export function useCompanySuccessions(companyId: string) {
  const route = useRoute();
  const user = useCurrentUser();

  const query = computed(() => ({
    companyId,
    ...(user.value || route.query.latest !== undefined
      ? { latest: route.query.latest ?? true }
      : {}),
  }));

  return authFetch<CompanySuccessions>("/api/edges/successions", {
    query,
    // Named after the company, so two companies do not abort each other's
    // request.
    key: `company-successions-${companyId}`,
  });
}
