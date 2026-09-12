<template>
  <!-- A single root element rather than the bare `v-for` fragment PartyChip is
       used as (EntityDetailsCard.vue:26). Two reasons, both found the hard way:
       a fragment root cannot inherit a caller's `class`, so a feed card that
       wants to nudge the row would get Vue's "Extraneous non-props attributes"
       warning and no class; and a wrapper without the `v-if` would still be a
       flex item in the host's `ga-2` row (EntityDetailsCard.vue:13), adding an
       8px gap next to the person's name on every person who has no badges -
       which is nearly all of them.

       `flex-wrap` because five chips plus the name and the party chips do not
       fit one phone-width line, and the header row must not push the admin
       controls off-screen. -->
  <div v-if="chips.length" class="d-flex align-center flex-wrap ga-2">
    <v-tooltip
      v-for="chip in chips"
      :key="chip.id"
      :text="tooltipFor(chip)"
      location="bottom"
      max-width="28rem"
    >
      <template #activator="{ props: tooltipProps }">
        <!-- `flat` with a colour, `outlined` without one, and never
             `variant="tonal" color="primary"`. Tonal draws the label in the
             chip's own colour, and this theme's primary is a pale sage: 1.73:1
             on its own 12% wash, which is how „Instytucja publiczna” came out
             unreadable (chip/PublicCompany.vue:4-8). Flat puts near-black on
             the sage instead, 11.3:1. article/MentionChips.vue still carries
             the tonal bug and is not a pattern to copy.

             The wash is also what separates the two states at a glance: a
             filled chip is something the site stands behind, an outlined one
             is something readers are still arguing about. That distinction has
             to survive without the tooltip, because a chip on a touch screen
             has no hover. -->
        <v-chip
          v-bind="tooltipProps"
          :color="chip.state === 'public' ? 'primary' : undefined"
          :variant="chip.state === 'public' ? 'flat' : 'outlined'"
          size="x-small"
          :data-testid="`badge-chip-${chip.id}`"
        >
          <!-- `aria-hidden` on the emoji: a screen reader announces 🚌 as
               „autobus” and 🤲 as „dłonie zwrócone ku górze”, read out before
               the title that already says what the badge is. The emoji is
               decoration for the eye; the title is the label. -->
          <span class="mr-1" aria-hidden="true">{{ chip.emoji }}</span
          >{{ chip.title }}
        </v-chip>
      </template>
    </v-tooltip>
  </div>
</template>

<script lang="ts" setup>
/** The read-only half of odznaki: a row of chips saying what readers have
 * voted this person is. No arrows, no counts, no link - the voting control is a
 * separate component, and in v1 there is no „wszyscy z odznaką X” page to link
 * to (it would need a composite index, and index deploys here are manual, see
 * frontend/SETUP.md).
 *
 * One component serves both surfaces that show badges, rather than one per
 * surface, so that the chip's appearance is decided in exactly one place:
 *
 *   - the person page hands over the whole node's `stats.badges` and
 *     `badgeModeration` and lets `visibleBadges` decide what this reader may
 *     see;
 *   - the „Co nowego” feed cards hand over `ids`, because the feed has already
 *     run `publicBadgeIds` on the server and carries the answer, not the raw
 *     tallies.
 *
 * Two components would also be two jscpd findings - the chip markup is the bulk
 * of the file and would be identical in both.
 */
import { computed } from "vue";
import {
  badgeById,
  visibleBadges,
  type BadgeChip,
  type BadgeState,
  type BadgeTally,
} from "~~/shared/badges";

const props = defineProps<{
  /** `node.stats.badges` - the per-badge tallies, keyed by bare badge id with
   * no `badge:` prefix. Absent until somebody votes: `computeBadgeStats` only
   * writes the field once there is a vote to count, so most people have no
   * `stats.badges` at all and that is the normal state, not a missing fetch. */
  stats?: Record<string, BadgeTally>;
  /** `person.badgeModeration` - an editor's verdict per badge. A map and not an
   * array on purpose: three states are needed (approved / hidden / nothing
   * decided), and this database's sanitized arrays come back as objects keyed
   * "0", "1", … so `array-contains` silently matches nothing (see the project
   * note on sanitized arrays). Lives on `Person`, not on `Node` - a caller
   * holding a `Node` needs `(x as Person | undefined)?.badgeModeration`. */
  moderation?: Record<string, "approved" | "hidden">;
  /** A ready-made list of badge ids, for callers that have already applied the
   * visibility rule elsewhere - today the feed cards, whose ids come from
   * `publicBadgeIds` on the server. Takes precedence over `stats` when both are
   * given, because it is the more specific instruction: it says *these*,
   * already filtered, rather than „work it out”. */
  ids?: string[];
  /** Whether the reader is logged in. Passed down rather than read from
   * `useAuthState()` here, which keeps this component a pure function of its
   * props: it is what lets a test mount the „proposal” state without an auth
   * mock, and what stops a feed card paying for an auth subscription per
   * tile. */
  signedIn?: boolean;
}>();

/** The state note a chip carries on top of its claim.
 *
 * Empty for „public” because there is nothing to explain: the chip looks like
 * every other filled chip on the page and the claim is the whole story. The
 * other two are the reason the chip is outlined, and a reader who sees a
 * different-looking chip asks that question first - so the note comes before
 * the claim, not after it.
 */
const stateNote: Record<BadgeState, string> = {
  public: "",
  proposal: "Propozycja czytelników — widoczna tylko dla zalogowanych.",
  awaiting: "Czeka na zatwierdzenie redakcji.",
};

/** What the tooltip says.
 *
 * Always the badge's `claim`, whatever the state. „Kot na cztery nogi” and
 * „W czepku urodzony” say nothing on their own - the same measured problem
 * `voteCategoryConfig[…].meaning` exists for on the five vote axes
 * (app/composables/votes.ts), where an alpha tester read the control as a
 * rating of the page rather than a verdict about the person. `evidence` is
 * deliberately not here: it tells a voter what to check before clicking, and
 * this row has nothing to click.
 */
function tooltipFor(chip: BadgeChip): string {
  const note = stateNote[chip.state];
  return note ? `${note} ${chip.claim}` : chip.claim;
}

/** The `ids` mode, built from the catalogue rather than from a tally.
 *
 * The caller's order is kept, not the catalogue's: the ids arrive from
 * `publicBadgeIds`, which sorts by support, and re-sorting here would throw
 * that away and make the feed disagree with the person page about which badge
 * comes first.
 *
 * Unknown ids are dropped silently instead of throwing. The list travels
 * through a Firestore document and a cached API response, so a badge retired -
 * or renamed by somebody who should not have - after the feed entry was written
 * is a thing that will happen; a person's card must not blow up over a label.
 * `badgeById` returns the widened `BadgeDefinition`, so reading `.retired` here
 * is fine - it is iterating the `as const` `badges` array directly that costs a
 * TS2339 (shared/badges.ts:262-273).
 */
const chipsFromIds = (ids: string[]): BadgeChip[] =>
  ids.flatMap((id) => {
    const definition = badgeById(id);
    if (!definition || definition.retired) return [];
    return [
      {
        id: definition.id,
        emoji: definition.emoji,
        title: definition.title,
        claim: definition.claim,
        // The counts are not shown by this row and the `ids` caller never had
        // them, so they are zeroed rather than guessed at. `state` is "public"
        // because that is what `publicBadgeIds` returns, by definition.
        up: 0,
        down: 0,
        support: 0,
        state: "public" as const,
      },
    ];
  });

const chips = computed<BadgeChip[]>(() =>
  props.ids
    ? chipsFromIds(props.ids)
    : visibleBadges(props.stats, props.moderation, {
        signedIn: !!props.signedIn,
      }),
);
</script>
