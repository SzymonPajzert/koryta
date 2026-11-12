/** How campaign mail leaves the site: a batch at a time, never all at once.
 *
 * The mail extension sends a `mail` document the moment it is written, and it
 * never tries again. The pilot wrote its 40 messages in one go on 2026-11-04:
 * Mailgun took 29 of them within four seconds and refused the other 11 with
 * "421 Domain koryta.pl is not allowed to send: recipient limit (26) exceeded,
 * try again after" a moment half a minute later. Its Free plan also stops at
 * 100 messages a day (UTC), counted over everything the site sends.
 *
 * So a campaign's messages are written held back, in a `delivery.state` the
 * extension leaves alone, and the scheduled function `releaseCampaignMail`
 * (functions/src/mail.ts) hands them over a batch at a time. Everything else
 * the site mails - notifications, newsletter confirmations, the owner's tests -
 * is one message at a time and goes out at once.
 *
 * Pure, so the server that queues a campaign and the function that releases
 * it share one set of numbers.
 */

/** `delivery.state` of a campaign message waiting for its batch. Not one of
 * the extension's states: it acts on a document with no `delivery` at all, or
 * in PENDING, RETRY or PROCESSING, and leaves this one alone until the release
 * sets PENDING. */
export const HELD_STATE = "HELD";

/** The most campaign messages handed over within `CAMPAIGN_BATCH_GAP_MS`:
 * well under the 26 Mailgun let through in half a minute. */
export const CAMPAIGN_BATCH_SIZE = 20;

/** How far apart two full batches are at least. The release runs once a
 * minute; the gap is a little shorter, so a run that starts a few seconds
 * early still sends its batch. */
export const CAMPAIGN_BATCH_GAP_MS = 50_000;

/** The most campaign messages handed over in one UTC day. Mailgun's Free plan
 * sends 100 a day in all, and the rest is left for the mail that is never
 * held. Raise it with the plan. */
export const CAMPAIGN_DAILY_LIMIT = 90;

/** Midnight UTC of the day `now` falls in, where Mailgun's daily count
 * starts over. */
export function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** How many held messages may go now, given how many were handed over within
 * the last `CAMPAIGN_BATCH_GAP_MS` and since midnight UTC. */
export function releaseRoom(released: {
  recently: number;
  today: number;
}): number {
  return Math.max(
    0,
    Math.min(
      CAMPAIGN_BATCH_SIZE - released.recently,
      CAMPAIGN_DAILY_LIMIT - released.today,
    ),
  );
}
