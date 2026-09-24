import { z } from "zod";
import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { buildActivityFeed } from "~~/server/utils/activityFeed";
import {
  identify,
  isEstablishedAdmin,
  listNewAdmins,
  readPublicProfiles,
  type ContributorIdentity,
} from "~~/server/utils/contributors";
import {
  defaultFeedRange,
  feedRanges,
  restrictedFeedKinds,
  type ActivityFeed,
  type FeedActor,
  type FeedBatch,
  type FeedRange,
  type FeedTarget,
  type RawFeed,
  type RawFeedTarget,
} from "~~/shared/activityFeed";

const queryValidator = z.object({
  // One of the two the page offers, not a range: every distinct value is its
  // own memo entry and its own scan. See `feedRanges`.
  days: z.coerce
    .number()
    .int()
    .refine(
      (value): value is FeedRange =>
        (feedRanges as readonly number[]).includes(value),
      { message: `days must be one of ${feedRanges.join(", ")}` },
    )
    .default(defaultFeedRange),
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far past now the scans read. A vote is stamped by the voter's browser,
 * and one whose clock runs a few minutes ahead should still show up; anything
 * further ahead is a broken or forged stamp, which with no bound at all would
 * sit at the top of the feed for as long as it stays in the future. */
const CLOCK_SKEW_MS = 10 * 60 * 1000;

/** Where an established administrator opens the revision behind a line. The
 * queue permalink, not /admin/rewizje/<node id>: that page is for nodes only,
 * and a line can just as well be about a relation. */
const revisionHref = (revisionId: string) =>
  `/admin/rewizje?rewizja=${encodeURIComponent(revisionId)}#kolejka`;

/** What people did to the data recently, one line per person per sitting.
 *
 * Signed-in only. The lines name what somebody rated, proposed or annotated,
 * with times, which says a good deal more about them than a count on the
 * statistics page; who is named follows the same `publicProfile` switch, and
 * everybody else is masked with no initial - next to a list of pages an initial
 * is enough to pick out a person.
 *
 * An established administrator (the `admin` claim without `newAdmin`) sees
 * every name and uid, the reasons, the revision links and which people are on
 * trial - that is the monitoring the page exists for. An administrator on trial
 * gets what any contributor gets: they are the ones being watched.
 */
export default defineEventHandler(async (event): Promise<ActivityFeed> => {
  const caller = await getUser(event);
  // Every response names the caller's own lines, and an administrator's names
  // everybody, so none of them may be kept by anything between here and them.
  setResponseHeader(event, "Cache-Control", "private, no-store");

  const { days } = await getValidatedQuery(event, (q) =>
    queryValidator.parse(q),
  );

  // Custom claims sit at the top level of a decoded token, but the token only
  // decides whether to ask: it can be an hour old, and an administrator put on
  // trial since it was issued still holds one without `newAdmin`. The account
  // decides - one auth lookup, on an administrator's request only. Not the
  // memo's identities: swr serves those well past five minutes old.
  const identified =
    caller.admin === true &&
    caller.newAdmin !== true &&
    (await isEstablishedAdmin(caller.uid));

  return present(await cachedFeed(days), caller.uid, identified);
});

type MemoizedFeed = {
  window: ActivityFeed["window"];
  /** Batches keyed by uid, with every restricted field. */
  raw: RawFeed;
  /** Display data and roles for every actor and every administrator on
   * trial. */
  identities: Record<string, ContributorIdentity>;
  /** Which actors agreed to be named in public. */
  public: Record<string, boolean>;
  newAdminUids: string[];
};

/** The feed as this caller may see it.
 *
 * Builds everything anew. The memo is one object handed to every caller of the
 * window, concurrent ones included, so writing a name or a key into it here
 * would show it to whoever asks next.
 */
function present(
  memo: MemoizedFeed,
  callerUid: string,
  identified: boolean,
): ActivityFeed {
  const actors = new Map<string, FeedActor>();
  let namedCount = 0;
  let maskedCount = 0;

  // Numbered by first appearance in this response, newest first, so the keys
  // mean nothing outside it - which is the point: a stable pseudonym would be
  // the linkable id the uid is withheld to avoid.
  const actorFor = (uid: string): FeedActor => {
    const known = actors.get(uid);
    if (known) return known;

    const publicName = publicNameOf(memo, uid);
    let actor: FeedActor;
    if (identified) {
      actor = identifiedActor(uid, memo, callerUid);
    } else if (uid === callerUid) {
      // Your own name is not a disclosure to you, whatever the setting says.
      // Without one, not "Ty": the chip already adds "· Ty" to your own line,
      // and "Ty · Ty" reads as a glitch rather than a prompt to set a name.
      const ownName = memo.identities[uid]?.displayName?.trim();
      actor = {
        key: "self",
        uid: null,
        name: ownName || "Bez nazwy",
        named: !!ownName,
        isSelf: true,
        photoURL: null,
        newAdmin: false,
        publicName: !!publicName,
      };
    } else if (publicName) {
      namedCount += 1;
      actor = {
        key: `named-${namedCount}`,
        uid: null,
        name: publicName,
        named: true,
        isSelf: false,
        photoURL: null,
        newAdmin: false,
      };
    } else {
      maskedCount += 1;
      actor = {
        key: `anon-${maskedCount}`,
        uid: null,
        name: `Anonim ${maskedCount}`,
        named: false,
        isSelf: false,
        photoURL: null,
        newAdmin: false,
      };
    }

    actors.set(uid, actor);
    return actor;
  };

  const batches = memo.raw.batches
    .filter(
      (batch) =>
        identified ||
        batch.uid === callerUid ||
        !restrictedFeedKinds.includes(batch.kind),
    )
    // `filter` has already copied the list, so this sorts the copy.
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .map((batch): FeedBatch => {
      const actor = actorFor(batch.uid);
      return {
        id: `${actor.key}:${batch.kind}:${batch.firstAt}`,
        kind: batch.kind,
        actorKey: actor.key,
        firstAt: batch.firstAt,
        lastAt: batch.lastAt,
        count: batch.count,
        objects: { ...batch.objects },
        alongEdges: batch.alongEdges,
        targets: presentTargets(batch.targets, identified),
        moreTargets: batch.moreTargets,
      };
    });

  return {
    window: { ...memo.window },
    identified,
    actors: [...actors.values()],
    batches,
    newAdmins: identified
      ? memo.newAdminUids.map((uid) => ({
          ...identifiedActor(uid, memo, callerUid),
          newAdmin: true,
        }))
      : [],
    truncated: [...memo.raw.truncated],
  };
}

/** The name everybody but an established administrator is shown for this
 * person, if any: one they agreed to show, and one there is - a blank display
 * name is masked like anybody's. */
function publicNameOf(memo: MemoizedFeed, uid: string): string | undefined {
  if (memo.public[uid] !== true) return undefined;
  return memo.identities[uid]?.displayName?.trim() || undefined;
}

/** An actor as an established administrator sees them: by uid, under the
 * name on the account or, failing that, its address. */
function identifiedActor(
  uid: string,
  memo: MemoizedFeed,
  callerUid: string,
): FeedActor {
  const identity = memo.identities[uid];
  const actor: FeedActor = {
    key: uid,
    uid,
    name: identity?.displayName || identity?.email || "Bez nazwy",
    named: true,
    isSelf: uid === callerUid,
    photoURL: null,
    newAdmin: identity?.newAdmin === true,
  };
  // Every name here is shown because the reader is an administrator, their
  // own included; whether the contributors see theirs is a separate answer.
  if (actor.isSelf) actor.publicName = !!publicNameOf(memo, uid);
  return actor;
}

/** A batch's targets as this caller may see them.
 *
 * The revision id stays behind for everybody but an established administrator:
 * a proposal's id embeds its author's uid. Keys are the target's own id, which
 * is in public URLs anyway; the same page twice in one batch (two proposals on
 * it) gets a counter rather than a revision id to tell the two apart.
 */
function presentTargets(
  targets: RawFeedTarget[],
  identified: boolean,
): FeedTarget[] {
  const seen = new Map<string, number>();
  return targets.map((target) => {
    const base = `${target.type}:${target.id}`;
    const repeat = (seen.get(base) ?? 0) + 1;
    seen.set(base, repeat);

    const presented: FeedTarget = {
      key: repeat === 1 ? base : `${base}:${repeat}`,
      type: target.type,
      name: target.name,
      href: target.href,
    };
    if (target.deleted !== undefined) presented.deleted = target.deleted;
    if (!identified) return presented;

    if (target.revisionId) {
      presented.revisionHref = revisionHref(target.revisionId);
    }
    if (target.selfApproved !== undefined) {
      presented.selfApproved = target.selfApproved;
    }
    if (target.reason) presented.reason = target.reason;
    return presented;
  });
}

/** The whole scan, memoized per window length and shared by every caller.
 *
 * Five minutes is how long a new line may take to appear, and the memo is also
 * what keeps the auth walk and the lookups off the per-request path. It holds
 * everything anyone may see - uids, reasons, revision ids - and `present`
 * strips it per caller on the way out.
 */
const cachedFeed = defineCachedFunction(
  async (days: FeedRange): Promise<MemoizedFeed> => {
    // Needed before the scan: what an administrator on trial imported is read
    // for their uids only.
    const newAdminUids = await listNewAdmins();

    const now = new Date();
    const since = new Date(now.getTime() - days * DAY_MS);
    const db = getFirestore(getApp(), "koryta-pl");

    const raw = await buildActivityFeed(db, {
      sinceIso: since.toISOString(),
      untilIso: new Date(now.getTime() + CLOCK_SKEW_MS).toISOString(),
      newAdminUids,
    });

    const actorUids = [...new Set(raw.batches.map((batch) => batch.uid))];
    const [identities, publicProfiles] = await Promise.all([
      identify([...new Set([...actorUids, ...newAdminUids])]),
      readPublicProfiles(db, actorUids),
    ]);

    return {
      // `until` is now, not where the scan stopped: the skew is tolerance for
      // other people's clocks, not part of the window.
      window: { since: since.toISOString(), until: now.toISOString(), days },
      raw: {
        ...raw,
        // A change written straight into the data is an administrator's
        // privilege. From anybody else it is a legacy row or a revision forged
        // through the client SDK, whose rules check only the author field, and
        // listing it would file it under the administrators' decisions.
        batches: raw.batches.filter(
          (batch) =>
            batch.kind !== "edit" || identities[batch.uid]?.admin === true,
        ),
      },
      identities,
      public: publicProfiles,
      newAdminUids,
    };
  },
  {
    name: "activity-feed",
    maxAge: 300,
    swr: true,
    getKey: (days: FeedRange) => String(days),
  },
);
