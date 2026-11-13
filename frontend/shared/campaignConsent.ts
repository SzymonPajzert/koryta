/** Whether a campaign message held back for its batch may still go out.
 *
 * A send decides who may be written to when it queues the messages
 * (`campaignEligibility`, over the audience `loadAudience` reads), but a
 * message then waits for its batch: a minute, or days once a day's allowance
 * is spent (shared/campaignPacing.ts). Whoever leaves the topic, turns team
 * mail off, has their account disabled or deleted, or stops being an
 * administrator in between must not get it. So the release asks again right
 * before a message leaves, and an unsubscribe asks at once about the reader's
 * own held mail - by the send's rules, over the same reads: the auth record,
 * the two fields of `users/{uid}`, a confirmed subscriber's topics. The
 * audience turns those reads into a recipient with the functions here too, so
 * the send and the release cannot come to judge one person differently.
 *
 * A message that may not go is withdrawn (`WITHDRAWN_STATE`): the release
 * never picks it up again, and nothing counts it as sent.
 *
 * The reads are passed in, typed by the shape of firebase-admin's Firestore
 * and Auth, so the server and the functions - each with its own copy of
 * firebase-admin - call the same code.
 */
import {
  campaignEligibility,
  campaignTopics,
  type AudienceMember,
  type CampaignTopic,
  type IneligibleReason,
  type MailPreferences,
} from "./campaigns";
import { WITHDRAWN_STATE } from "./campaignPacing";
import { SUBSCRIBERS, SUBSCRIBER_PREFIX } from "./newsletterSignup";

/** What `campaignEligibility` reads of a recipient. */
export type Consent = Pick<
  AudienceMember,
  "email" | "emailVerified" | "disabled" | "admin" | "preferences"
>;

/** The fields of an auth record a recipient's consent rests on, all of them
 * on firebase-admin's `UserRecord`. */
export type AccountRecord = {
  uid: string;
  email?: string | null;
  emailVerified: boolean;
  disabled: boolean;
  customClaims?: Record<string, unknown> | null;
};

/** A reader without an account who confirmed their address. */
export type ConfirmedSubscriber = {
  email: string;
  topics: Partial<Record<CampaignTopic, boolean>>;
};

/** The two fields campaigns read off a `users` document, and nothing else.
 *
 * The document is writable by its owner with no constraint on shape, so this
 * takes only booleans where booleans are expected, and an odd value counts as
 * no answer rather than a yes.
 */
export function mailPreferences(
  data: Record<string, unknown> | undefined,
): MailPreferences {
  const preferences: MailPreferences = {};
  const newsletter = data?.newsletter;
  if (newsletter && typeof newsletter === "object") {
    preferences.newsletter = topicChoices(newsletter);
  }
  if (typeof data?.teamMail === "boolean") preferences.teamMail = data.teamMail;
  return preferences;
}

/** An account as a campaign judges it: its address and its roles from the
 * auth service, its own choices from `users/{uid}`. */
export function accountConsent(
  account: AccountRecord,
  preferences: MailPreferences,
): Consent {
  return {
    email: account.email ?? null,
    emailVerified: account.emailVerified,
    disabled: account.disabled,
    admin: account.customClaims?.admin === true,
    preferences,
  };
}

/** A `newsletterSubscribers` document, if its address is confirmed: nobody
 * else is written to. Topics as on an account, booleans only. */
export function confirmedSubscriber(
  data: Record<string, unknown> | undefined,
): ConfirmedSubscriber | null {
  if (data?.status !== "confirmed") return null;
  return {
    email: String(data.email ?? ""),
    topics:
      data.topics && typeof data.topics === "object"
        ? topicChoices(data.topics)
        : {},
  };
}

/** A confirmed reader without an account: the address is theirs, or they could
 * not have confirmed it, and the topics are all they chose. */
export function subscriberConsent(subscriber: ConfirmedSubscriber): Consent {
  return {
    email: subscriber.email,
    emailVerified: true,
    disabled: false,
    admin: false,
    preferences: { newsletter: subscriber.topics },
  };
}

function topicChoices(stored: object): Partial<Record<CampaignTopic, boolean>> {
  const topics: Partial<Record<CampaignTopic, boolean>> = {};
  for (const topic of campaignTopics) {
    const choice = (stored as Record<string, unknown>)[topic];
    if (typeof choice === "boolean") topics[topic] = choice;
  }
  return topics;
}

/** What the check reads, as firebase-admin's Firestore and Auth offer it. */
export type ConsentReads = {
  db: {
    collection(path: string): { doc(id: string): unknown };
    getAll(
      ...refsAndOptions: unknown[]
    ): Promise<Array<{ id: string; data(): unknown }>>;
  };
  auth: {
    getUsers(
      identifiers: Array<{ uid: string } | { email: string }>,
    ): Promise<{ users: AccountRecord[] }>;
  };
};

/** `getUsers` takes at most this many identifiers a call. */
const USERS_PER_CALL = 100;

/** `getAll` takes its references as one argument list. */
const DOCS_PER_CALL = 300;

/** What the auth service takes as an address; anything else would fail the
 * whole call. */
const ADDRESS = /^[^@]+@[^@]+$/;

/** Each recipient's consent, read now. Recipients are ids as a campaign's
 * messages carry them: an account's uid, or `SUBSCRIBER_PREFIX` and a
 * subscriber's id.
 *
 * Somebody the audience would not list today is left out: an account deleted
 * since, a subscriber no longer confirmed, or a subscriber whose address has
 * an account now - the audience writes to that address as the account, whose
 * own switches say what it wants.
 */
export async function loadConsent(
  reads: ConsentReads,
  uids: string[],
): Promise<Map<string, Consent>> {
  const unique = [...new Set(uids)].filter(isDocumentId);
  const accountUids = unique.filter(
    (uid) => !uid.startsWith(SUBSCRIBER_PREFIX) && uid.length <= 128,
  );
  const subscriberIds = unique
    .filter((uid) => uid.startsWith(SUBSCRIBER_PREFIX))
    .map((uid) => uid.slice(SUBSCRIBER_PREFIX.length))
    .filter(isDocumentId);

  const subscriberDocs = await readDocs(reads.db, SUBSCRIBERS, subscriberIds, [
    "email",
    "status",
    "topics",
  ]);
  const subscribers = new Map<string, ConfirmedSubscriber>();
  for (const [id, data] of subscriberDocs) {
    const subscriber = confirmedSubscriber(data);
    if (subscriber) subscribers.set(id, subscriber);
  }

  const accounts = await readAccounts(reads.auth, [
    ...accountUids.map((uid) => ({ uid })),
    ...[...subscribers.values()]
      .filter((subscriber) => ADDRESS.test(subscriber.email))
      .map((subscriber) => ({ email: subscriber.email })),
  ]);
  const byUid = new Map(accounts.map((account) => [account.uid, account]));
  const accountAddresses = new Set(
    accounts.flatMap((account) =>
      account.email ? [account.email.toLowerCase()] : [],
    ),
  );
  const preferences = await readDocs(
    reads.db,
    "users",
    accountUids.filter((uid) => byUid.has(uid)),
    ["newsletter", "teamMail"],
  );

  const consent = new Map<string, Consent>();
  for (const uid of accountUids) {
    const account = byUid.get(uid);
    if (!account) continue;
    consent.set(
      uid,
      accountConsent(account, mailPreferences(preferences.get(uid))),
    );
  }
  for (const [id, subscriber] of subscribers) {
    if (accountAddresses.has(subscriber.email.toLowerCase())) continue;
    consent.set(`${SUBSCRIBER_PREFIX}${id}`, subscriberConsent(subscriber));
  }
  return consent;
}

/** Why a held message was withdrawn: whatever a send would now give as its
 * reason not to write to the recipient (`unknown` for somebody it would not
 * find at all), or that the account no longer has the address the message
 * was written to. */
export type WithdrawReason = IneligibleReason | "unknown" | "addressChanged";

export type HeldMailVerdict =
  { send: true } | { send: false; reason: WithdrawReason };

/** Whether a held message may go to its recipient now, given their consent as
 * `loadConsent` read it. `message` is the `mail` document: its `topic` is what
 * the reader is written to about, and what its footer and unsubscribe link
 * name. Any grounds will do, as for a send - a reader who has turned team mail
 * off but switched the topic on still wants it. */
export function heldMailVerdict(
  message: Record<string, unknown>,
  consent: Consent | undefined,
): HeldMailVerdict {
  if (!consent) return { send: false, reason: "unknown" };
  const topic = (campaignTopics as readonly unknown[]).includes(message.topic)
    ? (message.topic as CampaignTopic)
    : null;
  // Without its topic there is no saying what the reader agreed to.
  if (!topic) return { send: false, reason: "noConsent" };

  const eligibility = campaignEligibility(consent, topic);
  if (!eligibility.eligible) return { send: false, reason: eligibility.reason };

  // A confirmed address is the account's address now. One it has since
  // replaced was not confirmed for this.
  const to = Array.isArray(message.to) ? (message.to as unknown[]) : [];
  const address = consent.email?.toLowerCase();
  if (
    to.length !== 1 ||
    typeof to[0] !== "string" ||
    to[0].toLowerCase() !== address
  ) {
    return { send: false, reason: "addressChanged" };
  }
  return { send: true };
}

/** What a withdrawn message is updated with: `delivery` closed the way the
 * extension closes one, with an end time, but in a state of the site's own
 * that it leaves alone, and with no start time, so it counts as nothing
 * handed over. */
export function withdrawal(reason: WithdrawReason, now: Date) {
  return {
    delivery: { state: WITHDRAWN_STATE, endTime: now },
    withdrawn_reason: reason,
  };
}

/** A non-empty id with no slash, which is all a document id needs here. */
function isDocumentId(id: string): boolean {
  return id.length > 0 && !id.includes("/");
}

async function readDocs(
  db: ConsentReads["db"],
  collection: string,
  ids: string[],
  fieldMask?: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += DOCS_PER_CALL) {
    const refs = ids
      .slice(i, i + DOCS_PER_CALL)
      .map((id) => db.collection(collection).doc(id));
    const snapshots = await db.getAll(
      ...refs,
      ...(fieldMask ? [{ fieldMask }] : []),
    );
    for (const snapshot of snapshots) {
      const data = snapshot.data();
      if (data && typeof data === "object") {
        found.set(snapshot.id, data as Record<string, unknown>);
      }
    }
  }
  return found;
}

async function readAccounts(
  auth: ConsentReads["auth"],
  identifiers: Array<{ uid: string } | { email: string }>,
): Promise<AccountRecord[]> {
  const found: AccountRecord[] = [];
  for (let i = 0; i < identifiers.length; i += USERS_PER_CALL) {
    const { users } = await auth.getUsers(
      identifiers.slice(i, i + USERS_PER_CALL),
    );
    found.push(...users);
  }
  return found;
}
