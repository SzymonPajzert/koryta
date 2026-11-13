import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Firestore, Query } from "firebase-admin/firestore";
import { createError } from "h3";
import { z } from "zod";
import { isAlreadyExists, mailToken } from "~~/server/utils/mailTokens";
import {
  CAMPAIGN_STATS_DAYS,
  campaignEligibility,
  campaignLimits,
  campaignTopics,
  deliveryStates,
  renderCampaign,
  unsubscribeUrls,
  type AudienceMember,
  type CampaignContent,
  type CampaignMail,
  type CampaignQueue,
  type CampaignRecord,
  type CampaignSend,
  type CampaignTopic,
  type CommunityStats,
  type Delivery,
  type DeliveryState,
  type SendOutcome,
} from "~~/shared/campaigns";
import {
  CAMPAIGN_DAILY_LIMIT,
  HANDED_OVER_AT,
  HELD_STATE,
  WITHDRAWN_STATE,
  utcDayStart,
} from "~~/shared/campaignPacing";
import { taskSlug, uniqueTaskId } from "~~/shared/tasks";

/** The owner's campaigns: what each says, and who it has been sent to.
 * Server-only - written and read by /api/admin/mail/* for the owner. */
export const CAMPAIGNS = "mailCampaigns";

/** How many messages are rendered and queued at once. Each is a token read,
 * maybe a token write and a transaction on its `mail` document; ten keeps a
 * send of a few hundred to seconds without a burst of writes. Nothing is
 * mailed here: the messages are written held back, and go out a batch a
 * minute (shared/campaignPacing.ts). */
const SEND_CONCURRENCY = 10;

export const campaignContentSchema = z
  .object({
    subject: z
      .string()
      .trim()
      .min(1, "Temat nie może być pusty.")
      .max(campaignLimits.subject),
    body: z
      .string()
      .max(campaignLimits.body)
      .refine((body) => body.trim().length > 0, "Treść nie może być pusta."),
    ctaLabel: z.string().trim().max(campaignLimits.ctaLabel),
    ctaPath: z
      .string()
      .trim()
      .max(campaignLimits.ctaPath)
      .refine(
        (path) =>
          path === "" || (path.startsWith("/") && !path.startsWith("//")),
        "Link przycisku musi być ścieżką w serwisie, np. /eksploruj/nowe.",
      ),
    topic: z.enum(campaignTopics),
    includeStats: z.boolean(),
  })
  .refine((content) => !content.ctaLabel || content.ctaPath, {
    message: "Przycisk z napisem potrzebuje linku.",
    path: ["ctaPath"],
  });

export async function listCampaigns(db: Firestore): Promise<CampaignRecord[]> {
  const snapshot = await db.collection(CAMPAIGNS).get();
  return snapshot.docs
    .map((doc) => toRecord(doc.id, doc.data()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getCampaign(
  db: Firestore,
  id: string,
): Promise<CampaignRecord | null> {
  const snapshot = await db.collection(CAMPAIGNS).doc(id).get();
  return snapshot.exists ? toRecord(id, snapshot.data() ?? {}) : null;
}

/** Creates a campaign, or rewrites the text of one.
 *
 * Rewriting is allowed after a send on purpose: the pilot exists to find what
 * is wrong with a message before everybody gets it. Whoever already had it
 * keeps the old text and is not sent the new one.
 */
export async function saveCampaign(
  db: Firestore,
  args: { id?: string; content: CampaignContent; by: string; now: Date },
): Promise<CampaignRecord> {
  const at = args.now.toISOString();
  const content = pickContent(args.content);

  if (args.id) {
    const ref = db.collection(CAMPAIGNS).doc(args.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw createError({
        statusCode: 404,
        message: "Nie ma takiej kampanii.",
      });
    }
    await ref.update({ ...content, updatedAt: at });
    return toRecord(args.id, { ...snapshot.data(), ...content, updatedAt: at });
  }

  const base = `${at.slice(0, 10)}-${taskSlug(content.subject, 40)}`;
  const taken = new Set(
    (await db.collection(CAMPAIGNS).get()).docs.map((doc) => doc.id),
  );
  const data = {
    ...content,
    createdAt: at,
    updatedAt: at,
    createdBy: args.by,
    recipients: [],
    unsubscribed: [],
    sends: [],
  };
  // `create` rather than `set`, so two drafts saved in the same instant under
  // the same subject cannot overwrite one another.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = uniqueTaskId(base, taken);
    try {
      await db.collection(CAMPAIGNS).doc(id).create(data);
      return toRecord(id, data);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      taken.add(id);
    }
  }
  throw createError({
    statusCode: 409,
    message: "Nie udało się nadać kampanii identyfikatora. Spróbuj ponownie.",
  });
}

type SendArgs = {
  campaign: CampaignRecord;
  community: CommunityStats | null;
  siteUrl: string;
  now: Date;
};

/** Queues the campaign for each of `uids`, and records the send.
 *
 * Eligibility is decided here again, from `members` the server read itself:
 * the page only offers eligible people, but what it posts is the browser's
 * word. One `mail` document per campaign and person, so a second press - or a
 * later send to a wider group - never reaches anybody twice. The documents
 * written again are messages that never arrived: one whose delivery failed,
 * since the extension never retries, and one withdrawn before it went.
 *
 * Every message is written held back, and `releaseCampaignMail` lets them out
 * a batch a minute, asking again first whether each reader may still be
 * written to (shared/campaignConsent.ts); `queue` says how many wait and how
 * many more go today.
 */
export async function queueCampaign(
  db: Firestore,
  args: SendArgs & { members: AudienceMember[]; uids: string[]; by: string },
): Promise<{
  outcomes: Record<string, SendOutcome>;
  campaign: CampaignRecord;
  queue: CampaignQueue;
}> {
  const byUid = new Map(args.members.map((member) => [member.uid, member]));
  const uids = [...new Set(args.uids)];
  const outcomes: Record<string, SendOutcome> = {};

  for (let i = 0; i < uids.length; i += SEND_CONCURRENCY) {
    await Promise.all(
      uids.slice(i, i + SEND_CONCURRENCY).map(async (uid) => {
        outcomes[uid] = await queueOne(db, args, byUid.get(uid));
      }),
    );
  }

  const queued = uids.filter((uid) => outcomes[uid] === "queued");
  const send: CampaignSend = {
    at: args.now.toISOString(),
    by: args.by,
    test: false,
    outcomes: tally(Object.values(outcomes)),
  };
  const campaign = await recordSend(db, args.campaign.id, send, queued);
  const queue = await campaignQueue(db, args.now);
  console.info(
    `Campaign ${args.campaign.id}: queued ${queued.length}, requeued ${send.outcomes.requeued ?? 0} of ${uids.length}; ${queue.waiting} waiting, ${queue.leftToday} more can go today`,
  );
  return { outcomes, campaign, queue };
}

async function queueOne(
  db: Firestore,
  args: SendArgs,
  member: AudienceMember | undefined,
): Promise<SendOutcome> {
  if (!member) return "unknown";
  const eligibility = campaignEligibility(member, args.campaign.topic);
  if (!eligibility.eligible) return eligibility.reason;

  try {
    const mail = await renderFor(db, args, member, eligibility.via);
    const ref = db
      .collection("mail")
      .doc(`campaign_${args.campaign.id}_${member.uid}`);
    const message = {
      ...mailDocument(member.email!, mail),
      kind: "campaign",
      campaign: args.campaign.id,
      // What the reader agreed to be written to about, which the release
      // checks again before the message goes: the campaign's own topic may be
      // changed after the send, and this message's footer would not be.
      topic: args.campaign.topic,
      uid: member.uid,
      created_at: Timestamp.now(),
      // The extension leaves this alone until releaseCampaignMail lets it out
      // with its batch.
      delivery: { state: HELD_STATE },
    };
    return await db.runTransaction(async (tx): Promise<SendOutcome> => {
      const existing = await tx.get(ref);
      if (!existing.exists) {
        tx.create(ref, message);
        return "queued";
      }
      // Sent, held, or on its way: writing over any of those could mail it
      // twice. A failed one never went out, and the extension will not try
      // it again, and a withdrawn one never went either, so those are written
      // afresh - with today's text, which is what anybody new would get.
      const state = deliveryStateOf(existing.data());
      if (state !== "ERROR" && state !== WITHDRAWN_STATE) return "duplicate";
      tx.set(ref, message);
      return state === "ERROR" ? "requeued" : "queued";
    });
  } catch (error) {
    console.error(
      `Failed to queue campaign ${args.campaign.id} for uid=${member.uid}`,
      error,
    );
    return "failed";
  }
}

/** How much campaign mail waits to go out, of every campaign, and how much
 * more of it today's allowance lets out (shared/campaignPacing.ts): the day
 * counts every message the site has sent since midnight UTC, campaign or
 * not, as the release does. */
export async function campaignQueue(
  db: Firestore,
  now: Date,
): Promise<CampaignQueue> {
  const mail = db.collection("mail");
  const count = async (query: Query) =>
    (await query.count().get()).data().count;
  const [waiting, handedOverToday] = await Promise.all([
    count(mail.where("delivery.state", "==", HELD_STATE)),
    count(mail.where(HANDED_OVER_AT, ">=", utcDayStart(now))),
  ]);
  return {
    waiting,
    leftToday: Math.max(0, CAMPAIGN_DAILY_LIMIT - handedOverToday),
  };
}

function deliveryStateOf(data: Record<string, unknown> | undefined): unknown {
  return (data?.delivery as { state?: unknown } | undefined)?.state;
}

/** The owner's own copy, with "[Test]" in front of the subject, as many times
 * as they like. It goes to their own confirmed address only, and is recorded
 * as a test, so it counts nobody as having received the campaign. */
export async function queueTest(
  db: Firestore,
  args: SendArgs & { member: AudienceMember },
): Promise<{ outcome: SendOutcome; campaign: CampaignRecord }> {
  const { member } = args;
  let outcome: SendOutcome;
  if (member.disabled) outcome = "disabled";
  else if (!member.email) outcome = "noAddress";
  else if (!member.emailVerified) outcome = "unverified";
  else {
    const eligibility = campaignEligibility(member, args.campaign.topic);
    const mail = await renderFor(
      db,
      args,
      member,
      eligibility.eligible ? eligibility.via : "team",
    );
    try {
      await db
        .collection("mail")
        .doc(`campaignTest_${args.campaign.id}_${args.now.getTime()}`)
        .create({
          ...mailDocument(member.email, {
            ...mail,
            subject: `[Test] ${mail.subject}`,
          }),
          kind: "campaignTest",
          // Not `campaign`: a test must not read as the owner's real delivery.
          campaignTest: args.campaign.id,
          uid: member.uid,
          created_at: Timestamp.now(),
        });
      outcome = "queued";
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      outcome = "duplicate";
    }
  }

  const campaign = await recordSend(
    db,
    args.campaign.id,
    {
      at: args.now.toISOString(),
      by: member.uid,
      test: true,
      outcomes: { [outcome]: 1 },
    },
    [],
  );
  return { outcome, campaign };
}

async function renderFor(
  db: Firestore,
  args: SendArgs,
  member: AudienceMember,
  via: "optedIn" | "team",
): Promise<CampaignMail> {
  const token = await mailToken(db, member.uid);
  const subscriber = member.kind === "subscriber";
  return renderCampaign({
    campaignId: args.campaign.id,
    content: args.campaign,
    via,
    recipient: subscriber ? "subscriber" : "account",
    // A reader without an account has done nothing on the site to sum up.
    personal: subscriber
      ? null
      : {
          days: CAMPAIGN_STATS_DAYS,
          counts: member.activity.counts,
          total: member.activity.total,
        },
    community: args.community,
    siteUrl: args.siteUrl,
    unsubscribe: unsubscribeUrls(args.siteUrl, {
      uid: member.uid,
      token,
      topic: args.campaign.topic,
      campaignId: args.campaign.id,
    }),
  });
}

/** The fields the Trigger Email extension reads. `headers` carries the
 * one-click unsubscribe that mail clients offer next to the sender. */
function mailDocument(email: string, mail: CampaignMail) {
  return {
    to: [email],
    message: { subject: mail.subject, text: mail.text, html: mail.html },
    headers: mail.headers,
  };
}

async function recordSend(
  db: Firestore,
  id: string,
  send: CampaignSend,
  queued: string[],
): Promise<CampaignRecord> {
  const ref = db.collection(CAMPAIGNS).doc(id);
  await ref.update({
    ...(queued.length > 0
      ? { recipients: FieldValue.arrayUnion(...queued) }
      : {}),
    sends: FieldValue.arrayUnion(send),
    updatedAt: send.at,
  });
  return toRecord(id, (await ref.get()).data() ?? {});
}

function tally(outcomes: SendOutcome[]): Partial<Record<SendOutcome, number>> {
  const counts: Partial<Record<SendOutcome, number>> = {};
  for (const outcome of outcomes) counts[outcome] = (counts[outcome] ?? 0) + 1;
  return counts;
}

/** What the extension has done with each message of a campaign, by uid. */
export async function campaignDeliveries(
  db: Firestore,
  id: string,
): Promise<Record<string, Delivery>> {
  // Named fields only: the documents also hold the address and the whole text.
  const snapshot = await db
    .collection("mail")
    .where("campaign", "==", id)
    .select(
      "uid",
      "created_at",
      "released_at",
      "delivery.state",
      "delivery.endTime",
      "delivery.error",
    )
    .get();

  const deliveries: Record<string, Delivery> = {};
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (typeof data.uid !== "string") continue;
    const delivery = (data.delivery ?? {}) as Record<string, unknown>;
    // A held message reads as `queued`: nothing has picked it up yet.
    const state = (deliveryStates as readonly unknown[]).includes(
      delivery.state,
    )
      ? (delivery.state as DeliveryState)
      : "queued";
    deliveries[data.uid] = {
      state,
      // Messages from before the batches went out as they were written. A
      // held one has not been handed over yet, and a withdrawn one never was.
      queuedAt:
        delivery.state === HELD_STATE || delivery.state === WITHDRAWN_STATE
          ? null
          : (isoTime(data.released_at) ?? isoTime(data.created_at)),
      finishedAt: isoTime(delivery.endTime),
      error: typeof delivery.error === "string" ? delivery.error : null,
    };
  }
  return deliveries;
}

function isoTime(value: unknown): string | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return null;
}

function pickContent(content: CampaignContent): CampaignContent {
  return {
    subject: content.subject,
    body: content.body,
    ctaLabel: content.ctaLabel,
    ctaPath: content.ctaPath,
    topic: content.topic,
    includeStats: content.includeStats,
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toRecord(id: string, data: Record<string, unknown>): CampaignRecord {
  const topic = (campaignTopics as readonly unknown[]).includes(data.topic)
    ? (data.topic as CampaignTopic)
    : "callsToAction";
  return {
    id,
    subject: String(data.subject ?? ""),
    body: String(data.body ?? ""),
    ctaLabel: String(data.ctaLabel ?? ""),
    ctaPath: String(data.ctaPath ?? ""),
    topic,
    includeStats: data.includeStats === true,
    createdAt: String(data.createdAt ?? ""),
    updatedAt: String(data.updatedAt ?? ""),
    createdBy: String(data.createdBy ?? ""),
    recipients: strings(data.recipients),
    unsubscribed: strings(data.unsubscribed),
    sends: Array.isArray(data.sends) ? (data.sends as CampaignSend[]) : [],
  };
}
