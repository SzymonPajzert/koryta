import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { recordAudit } from "~~/server/utils/audit";
import { badges, type BadgeId } from "~~/shared/badges";
import { z } from "zod";

/** The catalogue as a zod enum, so a body naming a badge nobody ever wrote can
 * never reach the document.
 *
 * The cast is the price of `badges` being declared `as const satisfies
 * readonly BadgeDefinition[]`: `.map()` over it gives `BadgeId[]`, and
 * `z.enum` wants the non-empty tuple `[string, ...string[]]`. Widening it to
 * `string[]` and validating by hand would lose the compile-time union, which is
 * what makes the endpoint's `badgeId` the same type the client's
 * `useBadgeVotes` refuses to write outside of.
 *
 * Deriving it from the catalogue rather than listing five strings here is also
 * what makes adding a badge a one-file change: shared/badges.ts is the only
 * place the five ids are written down, and firestore.rules deliberately knows
 * nothing about them either.
 */
const badgeIds = badges.map((badge) => badge.id) as [BadgeId, ...BadgeId[]];

const bodyValidator = z.object({
  badgeId: z.enum(badgeIds),
  /** "approved" lets a badge that needs an editor out to the public once the
   * votes are there, "hidden" stops it reaching anybody at all, and `null`
   * clears the verdict.
   *
   * Three states, which is why the field this writes is a map and not two
   * arrays: a badge nobody has ruled on is *absent* from `badgeModeration`, and
   * that is different from approved and from blocked (shared/model.ts:362).
   * `null` rather than a separate DELETE route because clearing is the same
   * decision as the other two - an editor changing their mind - and it is the
   * one an admin reaches for after a wrong "hidden".
   */
  verdict: z.enum(["approved", "hidden"]).nullable(),
});

export type BadgeModerationResult = {
  node_id: string;
  badgeId: BadgeId;
  verdict: "approved" | "hidden" | null;
  /** The whole map as it stands after the write.
   *
   * Returned rather than left for the caller to refetch, because refetching
   * would not show it: `/api/nodes/[id]` is an `authCachedEventHandler` whose
   * `eventIsAuthenticated` is stubbed to `return false`
   * (server/utils/handlers.ts:5-7), so even a signed-in admin is served the
   * shared six-hour entry. The section overlays this on what it was given and
   * stops needing the network.
   */
  badgeModeration: Record<string, "approved" | "hidden">;
};

/** An editor's verdict on one reader-awarded badge on one person.
 *
 * An endpoint rather than a client write, and that is not a stylistic choice:
 * `firestore.rules` lets a reader write their *own* vote document and nothing
 * else on a node, admin claim or no admin claim. There is no rule under which a
 * browser may touch `nodes/<id>`, so the one way to record „redakcja mówi nie”
 * is the admin SDK, behind `requireAdmin` - the same shape `/api/nodes/publish`
 * and `/api/nodes/split` already have for the other two decisions only an admin
 * may make.
 *
 * # Why this is a field path and not a document write
 *
 * `update(nodeRef, new FieldPath("badgeModeration", badgeId), …)` writes one key
 * of the map. Reading the map, changing a key and writing it back would lose
 * the other verdicts whenever two admins act on the same person inside one
 * round trip - two badges on one person is the normal case, not a rare one, and
 * the loser of that race would be silently un-hidden.
 *
 * `FieldPath` with two explicit segments rather than the string
 * `"badgeModeration.kot-na-cztery-nogi"`. The string does work today - the SDK
 * splits it on dots and backticks any segment that is not a bare identifier
 * (@google-cloud/firestore path.js:634), so the hyphens survive - but it makes
 * the write depend on an id that never contains a dot, and a dot in an id would
 * not fail: it would quietly address a nested map one level down. The
 * catalogue's own comment forbids dots in an id for exactly this reason; this
 * is the same rule enforced where it is cheap to enforce.
 *
 * # Why the write goes through a batch
 *
 * One field of one document is a write `nodeRef.update` can do by itself, and
 * it did. The batch is here for the second write: this is a decision about
 * whether a public label stands next to a living person's name, and
 * `badgeModeration` records only the answer - the type is `Record<string,
 * "approved" | "hidden">` and stays that way, so it carries no uid and no
 * timestamp, and a cleared verdict leaves the map entirely. What was left was a
 * `console.info` in the container logs, which rotate away, so within weeks
 * nothing said who hid a badge or when.
 *
 * So the verdict and the `audit` row naming its author commit together, the way
 * `recordAudit` requires of every caller: the half-way state - a badge hidden
 * with nobody named for it - is the one the log exists to rule out.
 */
export default defineEventHandler(
  async (event): Promise<BadgeModerationResult> => {
    const id = getRouterParam(event, "id");
    if (!id) {
      throw createError({ statusCode: 400, message: "Brak id strony." });
    }

    const body = await readValidatedBody(event, (body) =>
      bodyValidator.parse(body),
    );

    const user = await requireAdmin(event);
    const db = getFirestore(getApp(), "koryta-pl");

    const nodeRef = db.collection("nodes").doc(id);
    const nodeDoc = await nodeRef.get();
    if (!nodeDoc.exists) {
      throw createError({
        statusCode: 404,
        message: `Nie ma strony o id: ${id}`,
      });
    }

    const stored = nodeDoc.data() ?? {};
    // Badges are handed to people, and `badgeModeration` is declared on
    // `Person` alone. Writing one onto a company would be a field no reader
    // ever looks at - `visibleBadges` is only ever asked about a person - and
    // an unreadable one to debug later, so the refusal is here rather than in
    // the UI that today is the only caller.
    if (stored.type !== "person") {
      throw createError({
        statusCode: 400,
        message: "Odznaki nadaje się tylko osobom.",
      });
    }

    const batch = db.batch();
    batch.update(
      nodeRef,
      new FieldPath("badgeModeration", body.badgeId),
      // Deleted rather than written as `null`: `visibleBadges` compares the
      // value against "approved" and "hidden" and treats everything else as „no
      // verdict”, so a stored `null` would read the same - but it would also
      // sit in the document forever, be handed to every reader of the person,
      // and make „nobody has ruled on this” indistinguishable from „an editor
      // cleared a ruling” for anybody reading the raw data.
      body.verdict === null ? FieldValue.delete() : body.verdict,
    );
    recordAudit(
      db,
      {
        action: "badge",
        collection: "nodes",
        target_id: id,
        user: user.uid,
        // Both, because neither is readable off the node afterwards: the
        // document holds the latest verdict per badge and no history, and a
        // cleared one is not in it at all. `body.verdict` is passed through
        // including its `null` - see the field's comment in shared/audit.ts.
        badge: { id: body.badgeId, verdict: body.verdict },
      },
      batch,
    );
    await batch.commit();

    // The map as the document now holds it, rebuilt from the copy read above
    // rather than read back: a second `get` would cost a read to learn what
    // this handler just decided. Filtered rather than `delete`d, which the
    // lint rule forbids on a computed key and which would mutate the snapshot's
    // own object.
    const previous = (stored.badgeModeration ?? {}) as Record<
      string,
      "approved" | "hidden"
    >;
    const moderation: Record<string, "approved" | "hidden"> =
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => key !== body.badgeId),
      );
    if (body.verdict !== null) moderation[body.badgeId] = body.verdict;

    // Every cached answer that carries this person - their own page above all -
    // was computed before the verdict and would go on showing the badge, or go
    // on hiding it, for up to six hours. The same line `/api/nodes/publish` and
    // `/api/nodes/split` end on, and for the same reason: it only reaches this
    // container's copy, which is where a reader who just clicked will land.
    await useStorage("cache").clear("nitro:handlers");

    return {
      node_id: id,
      badgeId: body.badgeId,
      verdict: body.verdict,
      badgeModeration: moderation,
    };
  },
);
