/** Voting on odznaki, the client half of shared/badges.ts.
 *
 * Proposing somebody for a badge *is* a vote for that badge, so there is one
 * verb here and not two: `vote(id, 1)` is both „zaproponuj” and „popieram”, and
 * what separates a proposal from a published chip is the count, decided at read
 * time by `visibleBadges` (shared/badges.ts).
 *
 * The vote itself is a key in the reader's existing vote document - the same
 * `votes/${nodeId}_${uid}` the five `VoteCategory` axes live in, under
 * `badge:<id>`. That is why this composable is a thin thing over
 * `useVoteDocument` rather than a second store: one document, one listener, one
 * write path, and a reader's badge votes travel with the rest of their opinion
 * about the person.
 */

import { ref, type MaybeRef } from "vue";
import { badgeById, badgeKey } from "~~/shared/badges";
import { trackGoal } from "~/composables/analytics";
import { useVoteDocument } from "~/composables/votes";

/** The goal each direction reports, by the value that ends up in the document.
 *
 * Three goals rather than one goal with a `direction` property, because the
 * three answer different questions and want different denominators: proposals
 * say whether the catalogue is worth offering at all, opposition says whether a
 * badge is contested (and so whether `requiresApproval` is doing any work), and
 * a withdrawal is a reader changing their mind, which is the only one of the
 * three that is not a first-time act.
 *
 * The return type is the three names spelled out rather than `string`.
 * `trackGoal` takes its goal as `G extends AnalyticsGoal` and derives the
 * accepted property set from it (`TrackArgs`, app/composables/analytics.ts), so
 * a `string` here would force a cast at the call site and would switch off, for
 * the three newest goals in the file, the one guarantee that module exists to
 * give: a goal that is not registered in `GOALS`, or a property set that does
 * not match the goal's, fails the build. All three are registered, with
 * `props: ["badge"]` (shared/analytics.ts).
 */
function badgeGoal(
  next: -1 | 0 | 1,
): "osoba:badge-proposed" | "osoba:badge-opposed" | "osoba:badge-withdrawn" {
  if (next > 0) return "osoba:badge-proposed";
  if (next < 0) return "osoba:badge-opposed";
  return "osoba:badge-withdrawn";
}

function trackBadgeVote(next: -1 | 0 | 1, badge: string): void {
  // `badge` is a catalogue id and nothing else - `vote` has already refused
  // anything `badgeById` does not know - so this honours the „no free text,
  // bounded values” rule the property vocabulary is built on, and the five-row
  // breakdown on the dashboard can never grow a sixth row from a typo.
  trackGoal(badgeGoal(next), { badge });
}

/** This reader's badge votes on one person, and the one way to change them.
 *
 * `personId` may be a ref: the person page resolves its id from the route, and
 * `useVoteDocument` follows it, so a client-side navigation between two people
 * re-points the listener instead of stranding it on the previous one.
 */
export function useBadgeVotes(personId: MaybeRef<string>) {
  // The target stays at its default „node”. A badge is a label on a human
  // being; an extraction is a sentence about a fact, and there is nothing there
  // to hand a badge to.
  const { categoryVotes, write } = useVoteDocument(personId);

  /** True while a write is in flight. One flag for the whole control rather
   * than one per badge, because all of them are keys in a single document and
   * a single `setDoc`: there is only ever one write to be waiting for. */
  const loading = ref(false);

  /** Which way this reader voted on `id`: 1 up, -1 down, 0 never or withdrawn.
   *
   * The *sign*, not the value. Two reasons, and neither is defensive
   * programming for its own sake. The rules allow -5..5 in this map because the
   * five `VoteCategory` axes need that range, so a value of any magnitude can
   * legitimately be sitting under a `badge:` key - written by an older build, a
   * script, or a hand-edited document - and a badge control has exactly two
   * positions to render it in. And it is the same reading `computeBadgeStats`
   * (shared/stats.ts) applies when it counts the tally: one person is at most
   * one vote there, so if the arrow disagreed with the counter about what a
   * stored 5 means, the reader would see their own click missing from the total.
   *
   * A non-number reads as 0 rather than as NaN: `Math.sign(NaN)` is NaN, which
   * is neither up nor down for rendering *and* never equal to `value` below, so
   * the toggle could never withdraw it.
   */
  function myVote(id: string): -1 | 0 | 1 {
    const raw = Number(categoryVotes.value[badgeKey(id)]);
    if (!Number.isFinite(raw)) return 0;
    return Math.sign(raw) as -1 | 0 | 1;
  }

  /** Vote `value` on `id`, or withdraw if that is already this reader's vote.
   *
   * Returns true when something was written. False means nothing was: an id
   * outside the catalogue, a retired badge, a write already in flight, or no
   * signed-in user - in which case `useVoteDocument` has sent them to /login.
   * It throws whatever Firestore threw, deliberately; see the note on `write`.
   *
   * Clicking the same arrow twice writes **0**, not a field deletion. A stored
   * 0 is a vote for neither side - `computeBadgeStats` signs the value, so it
   * counts in no column - and it keeps the write a plain
   * `Record<string, number>`, which is what `VoteDocument.categoryVotes`
   * (shared/model.ts) is typed as and what the rules validate. `deleteField()`
   * is a sentinel object in a map the rules check the value types of, and it
   * would buy one key back in a document capped at `MAX_VOTE_KEYS` = 40.
   */
  async function vote(id: string, value: 1 | -1): Promise<boolean> {
    // The catalogue is the gate. `categoryVotes` is a free-form map this reader
    // can write to directly, so refusing an unknown id here does not make the
    // key unwritable - `isKnownBadge` in shared/badges.ts is what stops it ever
    // being counted - but it does stop our own UI minting a counter on a public
    // node document from a typo or a stale link.
    const definition = badgeById(id);
    if (!definition) return false;
    // Retired badges keep their tallies (so retiring stays reversible) and are
    // not offered for voting. `badgeById` returns the widened
    // `BadgeDefinition`, which is the only way to read `retired` at all: the
    // catalogue is declared `as const satisfies …`, so the field is absent from
    // `badges`'s literal type and reading it there is a TS2339 that fails the
    // triggers' build rather than a test.
    if (definition.retired) return false;

    // The toggle is derived from the live document, and the listener has not
    // seen the write that is in flight yet - so a second click on the same
    // badge would re-send the value it already sent instead of undoing it.
    // Refusing is the cheaper of the two wrong answers: it costs a click, and
    // the other costs a write that refires `onVoteWritten` over every vote on
    // the person for no change at all.
    if (loading.value) return false;

    const next: -1 | 0 | 1 = myVote(id) === value ? 0 : value;

    loading.value = true;
    try {
      const written = await write({ [badgeKey(id)]: next });
      if (!written) return false;
      // After the write, never before: a goal recorded for a vote that a rules
      // rejection threw away would make the dashboard the only place the badge
      // ever existed.
      trackBadgeVote(next, id);
      return true;
    } finally {
      loading.value = false;
    }
  }

  return { myVote, vote, loading };
}
