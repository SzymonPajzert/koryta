/** Where the extension sends what it captures.
 *
 * Overridable because the whole flow has to be exercisable against
 * `npm run dev:local` before anything is published; the popup shows the
 * override when it is not the default, so nobody is left wondering why their
 * captures are not on the site.
 */
export const DEFAULT_ORIGIN = "https://koryta.pl";

/** `scheme://host:port`, from whatever someone typed into Ustawienia.
 *
 * A bare `localhost:3000` has to be rejected or repaired, and repairing it is
 * kinder. It cannot simply be stored: `new URL("localhost:3000")` does not
 * throw — it reads `localhost:` as the *protocol* — so nothing complains until
 * `fetch` refuses the address much later, and the only symptom is "Failed to
 * fetch" with no clue as to which part was wrong.
 *
 * Throws rather than falling back to the default, which for an unusable address
 * would quietly send a capture to production instead of to the dev server the
 * person was aiming at.
 */
export function normalizeOrigin(value) {
  // Not stripped of trailing slashes before parsing: that turns "http://" into
  // "http:", which then reads as a host and comes back as "http://http". The
  // reconstruction below drops the path anyway.
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new Error("podaj adres serwisu");

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`zły adres: ${value}`);
  }
  if (!url.host) throw new Error(`zły adres: ${value}`);
  return `${url.protocol}//${url.host}`;
}

export async function getOrigin() {
  const { origin } = await chrome.storage.local.get("origin");
  if (!origin) return DEFAULT_ORIGIN;
  // Normalised on the way out as well as in, so an address stored before this
  // existed starts working rather than staying broken until someone thinks to
  // retype it.
  try {
    return normalizeOrigin(origin);
  } catch {
    return DEFAULT_ORIGIN;
  }
}

export async function setOrigin(origin) {
  await chrome.storage.local.set({ origin: normalizeOrigin(origin) });
}

/** An id token is good for an hour; treat it as spent early rather than have a
 * capture fail on a token that expired between the check and the request. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
