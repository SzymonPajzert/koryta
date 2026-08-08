/** Where the extension sends what it captures.
 *
 * Overridable because the whole flow has to be exercisable against
 * `npm run dev:local` before anything is published; the popup shows the
 * override when it is not the default, so nobody is left wondering why their
 * captures are not on the site.
 */
export const DEFAULT_ORIGIN = "https://koryta.pl";

export async function getOrigin() {
  const { origin } = await chrome.storage.local.get("origin");
  return origin || DEFAULT_ORIGIN;
}

export async function setOrigin(origin) {
  await chrome.storage.local.set({ origin: origin.replace(/\/$/, "") });
}

/** An id token is good for an hour; treat it as spent early rather than have a
 * capture fail on a token that expired between the check and the request. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
