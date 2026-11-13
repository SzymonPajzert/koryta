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
 * is one message at a time and goes out at once, so the batches make room for
 * it: both limits below count every message handed to the extension, not only
 * campaign mail.
 *
 * Pure, so the server that queues a campaign and the function that releases
 * it share one set of numbers.
 */

/** `delivery.state` of a campaign message waiting for its batch. Not one of
 * the extension's states: it acts on a document with no `delivery` at all, or
 * in PENDING, RETRY or PROCESSING, and leaves this one alone until the release
 * sets PENDING. */
export const HELD_STATE = "HELD";

/** `delivery.state` of a held campaign message that will never go: by the
 * time its batch came, or its reader unsubscribed, they could no longer be
 * written to (shared/campaignConsent.ts). The extension leaves it alone as it
 * does HELD, the release never picks it up, and it counts as nothing handed
 * over. A later send writes it afresh, as it does a failed one. */
export const WITHDRAWN_STATE = "WITHDRAWN";

/** When a message was handed to the mail extension, which is what both limits
 * count. The extension stamps it on every message it takes up, whatever sent
 * it, and the release on every one it lets out; a held or withdrawn message
 * has none. */
export const HANDED_OVER_AT = "delivery.startTime";

/** The most messages, of any kind, handed over within `CAMPAIGN_BATCH_GAP_MS`:
 * well under the 26 Mailgun let through in half a minute. */
export const CAMPAIGN_BATCH_SIZE = 20;

/** How far apart two full batches are at least. The release runs once a
 * minute; the gap is a little shorter, so a run that starts a few seconds
 * early still sends its batch. */
export const CAMPAIGN_BATCH_GAP_MS = 50_000;

/** Once this many messages of any kind - campaigns, notifications, newsletter
 * confirmations, the owner's tests - have been handed over in a UTC day,
 * campaign mail stops until the next. Mailgun's Free plan sends 100 a day in
 * all; the 10 above this are kept for the mail that comes after a campaign has
 * used the day up, which is never held, and which the extension would
 * otherwise see refused and never try again. Raise it with the plan. */
export const CAMPAIGN_DAILY_LIMIT = 90;

/** Midnight UTC of the day `now` falls in, where Mailgun's daily count
 * starts over. */
export function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** How many held messages may go now, given how many messages of any kind
 * were handed over within the last `CAMPAIGN_BATCH_GAP_MS` and since midnight
 * UTC. */
export function releaseRoom(handedOver: {
  recently: number;
  today: number;
}): number {
  return Math.max(
    0,
    Math.min(
      CAMPAIGN_BATCH_SIZE - handedOver.recently,
      CAMPAIGN_DAILY_LIMIT - handedOver.today,
    ),
  );
}
