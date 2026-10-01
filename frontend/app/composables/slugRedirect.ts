import { slugRedirectCode } from "./slugs";

/** Sends a server-rendered request for a node on to `url`, the address
 * `generateNodeUrl` gives it, with the status `slugRedirectCode` picks.
 *
 * `no-store` on every one of them, and that is what makes the 301s safe: a
 * search engine still reads a 301 as a move, but no browser and no CDN keeps
 * the answer, so the next deploy is free to give a different one. Without it a
 * rename that went A -> B -> A would leave a browser that saw the first answer
 * looping, A sending it to B from its cache and the server sending it back.
 *
 * Kept out of `slugs.ts`, which the server imports and which has to stay free
 * of the app's composables. */
export function redirectToNodeUrl(url: string) {
  useResponseHeader("cache-control").value = "no-store";
  return navigateTo(url, { redirectCode: slugRedirectCode(url) });
}
