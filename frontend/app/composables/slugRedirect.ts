import { parseQuery, stringifyQuery, type LocationQuery } from "vue-router";
import { slugRedirectCode } from "./slugs";

/** Where a redirect to a node's own address sends the reader: that address,
 * with the query and the hash of the one they asked for.
 *
 * A bare path used to be enough, until links started carrying something past
 * it. A proposal is previewed as `?revisionId=`, and the links to that preview
 * name the page by an address that is not its own: /admin/rewizje by its
 * /entity/ url, the list of a reader's proposals by the name the proposal
 * gives it. Both go through a redirect, and the redirect dropped the query - so
 * the preview of a renamed article opened the article as it was.
 *
 * A string, not a location object: a region's address is the table with its
 * own `?teryt=`, and vue-router reads only the path out of an object's `path`.
 * That query wins over one of the same name in the link. */
export function nodeUrlLocation(
  url: string,
  from: { query: LocationQuery; hash: string },
): string {
  const [path, own = ""] = url.split("?");
  const query = stringifyQuery({ ...from.query, ...parseQuery(own) });
  return `${path}${query ? `?${query}` : ""}${from.hash}`;
}

/** Sends a server-rendered request for a node on to `url`, the address
 * `generateNodeUrl` gives it, with the status `slugRedirectCode` picks, and the
 * query and the hash of `from` - see `nodeUrlLocation`.
 *
 * `no-store` on every one of them, and that is what makes the 301s safe: a
 * search engine still reads a 301 as a move, but no browser and no CDN keeps
 * the answer, so the next deploy is free to give a different one. Without it a
 * rename that went A -> B -> A would leave a browser that saw the first answer
 * looping, A sending it to B from its cache and the server sending it back.
 *
 * Kept out of `slugs.ts`, which the server imports and which has to stay free
 * of the app's composables. */
export function redirectToNodeUrl(
  url: string,
  from: { query: LocationQuery; hash: string },
) {
  useResponseHeader("cache-control").value = "no-store";
  return navigateTo(nodeUrlLocation(url, from), {
    redirectCode: slugRedirectCode(url),
  });
}
