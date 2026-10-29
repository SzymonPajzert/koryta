import { authRequest } from "~/composables/auth";
import type { PersonDeclarations } from "~~/shared/declarations";

/** The anchor the header's line points down to, on the section that lists
 * the declarations with the articles. */
export const DECLARATIONS_ANCHOR = "oswiadczenia-majatkowe";

/** A published person's asset declarations on BIP
 * (`/api/nodes/<id>/declarations`), for the line under their facts and for
 * the section that lists the documents with the articles: one key, so the two
 * share one request.
 *
 * Asked for in the browser only and never awaited: it is a footnote to the
 * page, all `data-nosnippet`, and must not hold up the rest of it. The
 * endpoint answers 404 for a page that is not public or has nothing to show,
 * which here is simply nothing.
 *
 * `dedupe: "defer"`: the line and the section mount in one pass, and under
 * the default ("cancel") the second one's first fetch cancelled the first
 * one's and asked again - two requests a page view, the first thrown away. */
export function usePersonDeclarations(nodeId: string) {
  return useAsyncData<PersonDeclarations | null>(
    `person-declarations-${nodeId}`,
    () =>
      authRequest<PersonDeclarations>(`/api/nodes/${nodeId}/declarations`, {
        method: "GET",
      }).catch(() => null),
    { server: false, lazy: true, dedupe: "defer" },
  );
}

/** The declarations once each, newest first: one file can serve two
 * candidacies of the same person, and the endpoint may list it for both. */
export function uniqueDeclarations(
  data: PersonDeclarations | null | undefined,
): PersonDeclarations["declarations"] {
  const seen = new Set<string>();
  return (data?.declarations ?? [])
    .filter((declaration) => {
      if (!declaration.url || seen.has(declaration.url)) return false;
      seen.add(declaration.url);
      return true;
    })
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}
