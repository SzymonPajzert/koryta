import type { Page } from "@playwright/test";

/** "Now", for the pages that print how long ago something happened.
 *
 * Every row on the admin lists ends in „3 dni temu”, counted against the
 * reader's clock, so a baseline taken today reads differently tomorrow. With
 * the browser's clock stopped here, a date in a fixture - or in the seed -
 * always comes out the same distance away.
 *
 * In the past rather than the future: the Firebase SDK compares its ID token's
 * expiry against this clock, and a clock past the expiry would have it
 * refreshing the token over and over. It only reaches what the browser draws.
 * A page the server renders counts from the server's own clock, which is why
 * the pages frozen here are the client-rendered ones - /admin/** - or are
 * reached by a client-side navigation. */
export const NOW = new Date("2026-09-01T10:00:00Z");

export const freezeClock = (page: Page) => page.clock.setFixedTime(NOW);

/** Days before `NOW`, as the ISO string the APIs send. */
export const daysAgo = (days: number, hour = 9) =>
  new Date(
    Date.UTC(
      NOW.getUTCFullYear(),
      NOW.getUTCMonth(),
      NOW.getUTCDate() - days,
      hour,
    ),
  ).toISOString();
