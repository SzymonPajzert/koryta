import { describe, it, expect } from "vitest";
import {
  BADGE_KEY_PREFIX,
  BADGE_PUBLIC_THRESHOLD,
  badgeIdFromKey,
  badgeKey,
  badgeMinVotes,
  badges,
  isBadgeKey,
  isKnownBadge,
  publicBadgeIds,
  visibleBadges,
  type BadgeTally,
} from "~~/shared/badges";

const tally = (up: number, down = 0): BadgeTally => ({ up, down });

describe("shared/badges.ts", () => {
  describe("the catalogue", () => {
    /** An id is a Firestore map key in two places at once - `badge:<id>` inside
     * a vote's `categoryVotes`, and `<id>` inside `stats.badges` and
     * `badgeModeration` - so the shape is a constraint of the database, not a
     * style rule. A dot would make `update("stats.badges.a.b")` address a
     * nested map; an underscore collides with the `${nodeId}_${uid}` document
     * id `ownsVoteTarget` in firestore.rules matches on; a Polish letter has to survive urls,
     * rule expressions and log lines. */
    it("gives every badge an ASCII kebab-case id", () => {
      for (const badge of badges) {
        expect(badge.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    });

    it("has no two badges under one id", () => {
      const ids = badges.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    /** The five the product owner picked, in the order they chose, which is
     * also the tie-break in `visibleBadges`. Pinned so that adding a badge in
     * the middle of the list - which reorders chips on every person - is a
     * decision somebody makes rather than a diff nobody notices. */
    it("carries the five v1 badges in order", () => {
      expect(badges.map((b) => b.id)).toEqual([
        "kot-na-cztery-nogi",
        "w-czepku-urodzony",
        "omnibus",
        "spolecznik",
        "zmiana-barw",
      ]);
    });

    /** „Społecznik” states the type of an organ rather than characterising a
     * person, and 892 seats across 238 hospitals are stored wrongly - an editor
     * in front of each correction would be 892 clicks to learn nothing. Every
     * other badge says something about the person and waits for one. */
    it("requires an editor for everything except Społecznik", () => {
      const free = badges.filter((b) => !b.requiresApproval).map((b) => b.id);
      expect(free).toEqual(["spolecznik"]);
    });

    it("says in the first person what each direction asserts", () => {
      for (const badge of badges) {
        expect(badge.claim).toContain("W górę:");
        expect(badge.evidence.length).toBeGreaterThan(40);
      }
    });
  });

  describe("vote keys", () => {
    it("round-trips an id through the categoryVotes key", () => {
      expect(badgeKey("omnibus")).toBe(`${BADGE_KEY_PREFIX}omnibus`);
      expect(isBadgeKey(badgeKey("omnibus"))).toBe(true);
      expect(badgeIdFromKey(badgeKey("omnibus"))).toBe("omnibus");
    });

    /** The five vote axes share the map with the badges, so this is what keeps
     * `computeVoteStats` from summing a badge as a sixth axis. */
    it("does not mistake a vote category for a badge", () => {
      expect(isBadgeKey("interesting")).toBe(false);
      // "" rather than the key itself, so a caller that skipped `isBadgeKey`
      // still fails the catalogue lookup instead of smuggling the key through.
      expect(badgeIdFromKey("interesting")).toBe("");
      expect(isKnownBadge(badgeIdFromKey("interesting"))).toBe(false);
    });

    it("rejects an id nobody put in the catalogue", () => {
      expect(isKnownBadge("omnibus")).toBe(true);
      expect(isKnownBadge("zlodziej")).toBe(false);
      expect(isKnownBadge("")).toBe(false);
    });

    it("falls back to the shared threshold for a badge with no override", () => {
      expect(badgeMinVotes("omnibus")).toBe(BADGE_PUBLIC_THRESHOLD);
      // Unknown ids get the default rather than 0: a threshold of 0 would make
      // a single vote enough for anything the catalogue has never heard of.
      expect(badgeMinVotes("zlodziej")).toBe(BADGE_PUBLIC_THRESHOLD);
    });
  });

  describe("visibleBadges", () => {
    it("shows nobody a badge an editor hid", () => {
      // An editor's „nie” outranks any number of readers, and it has to outrank
      // them for a signed-in reader too: the point of hiding is that the claim
      // stops being made about this person, not that it moves behind a login.
      const tallies = { omnibus: tally(9) };
      const moderation = { omnibus: "hidden" as const };

      expect(visibleBadges(tallies, moderation, { signedIn: true })).toEqual(
        [],
      );
      expect(visibleBadges(tallies, moderation, { signedIn: false })).toEqual(
        [],
      );
    });

    it("does not show a badge the votes do not support", () => {
      // Three people disputing one proposer is -2, and a badge at parity has
      // nothing to say either. Both are the same case: support <= 0.
      expect(
        visibleBadges({ omnibus: tally(1, 3) }, {}, { signedIn: true }),
      ).toEqual([]);
      expect(
        visibleBadges({ omnibus: tally(4, 4) }, {}, { signedIn: true }),
      ).toEqual([]);
    });

    it("shows a proposal to a signed-in reader and to nobody else", () => {
      // Below the threshold a badge is one or two people's opinion. The people
      // who can vote need to see what needs voting on; a logged-out visitor
      // would just be reading an unreviewed claim about a named person.
      const tallies = { omnibus: tally(2) };

      const forMember = visibleBadges(tallies, {}, { signedIn: true });
      expect(forMember).toHaveLength(1);
      expect(forMember[0]!.state).toBe("proposal");
      expect(forMember[0]!.support).toBe(2);
      expect(forMember[0]!.emoji).toBe("🚌");

      expect(visibleBadges(tallies, {}, { signedIn: false })).toEqual([]);
    });

    it("holds a badge at the threshold back until an editor approves it", () => {
      const tallies = { omnibus: tally(3) };

      const forMember = visibleBadges(tallies, {}, { signedIn: true });
      expect(forMember.map((c) => c.state)).toEqual(["awaiting"]);
      expect(visibleBadges(tallies, {}, { signedIn: false })).toEqual([]);

      const approved = visibleBadges(
        tallies,
        { omnibus: "approved" },
        { signedIn: false },
      );
      expect(approved.map((c) => c.state)).toEqual(["public"]);
    });

    /** The one badge that goes public on the votes alone - see the catalogue
     * test above for why. */
    it("publishes Społecznik on three votes without an editor", () => {
      const chips = visibleBadges(
        { spolecznik: tally(3) },
        {},
        { signedIn: false },
      );
      expect(chips.map((c) => c.id)).toEqual(["spolecznik"]);
      expect(chips[0]!.state).toBe("public");

      // Still three people, though: two is a proposal like anything else.
      expect(
        visibleBadges({ spolecznik: tally(2) }, {}, { signedIn: false }),
      ).toEqual([]);
    });

    it("counts the dissenters against the threshold", () => {
      // Four proposers and two objectors is a net two, which is a proposal -
      // otherwise a badge could be pushed public by volume while the people who
      // looked closest were saying no.
      const chips = visibleBadges(
        { spolecznik: tally(4, 2) },
        {},
        { signedIn: true },
      );
      expect(chips[0]!.state).toBe("proposal");
      expect(chips[0]!.up).toBe(4);
      expect(chips[0]!.down).toBe(2);
    });

    it("drops a tally under an id that is not in the catalogue", () => {
      // `categoryVotes` is a free-form map a signed-in client writes directly,
      // so an invented key does reach the aggregate if nothing filters it.
      const chips = visibleBadges(
        { zlodziej: tally(9), omnibus: tally(4) },
        { omnibus: "approved" },
        { signedIn: true },
      );
      expect(chips.map((c) => c.id)).toEqual(["omnibus"]);
    });

    it("orders by support, catalogue order on a tie", () => {
      const chips = visibleBadges(
        {
          // Both at 4, and „Kot na cztery nogi” is first in the catalogue.
          "kot-na-cztery-nogi": tally(4),
          "zmiana-barw": tally(4),
          omnibus: tally(7),
        },
        {
          "kot-na-cztery-nogi": "approved",
          "zmiana-barw": "approved",
          omnibus: "approved",
        },
        { signedIn: true },
      );

      expect(chips.map((c) => c.id)).toEqual([
        "omnibus",
        "kot-na-cztery-nogi",
        "zmiana-barw",
      ]);
    });

    it("treats a missing tally, a missing field and a half-written one as empty", () => {
      // The tally comes off a Firestore document, so a missing `down` must read
      // as 0 rather than turning support into NaN - which compares false
      // against every threshold and would make the badge vanish silently.
      expect(visibleBadges(undefined, undefined, { signedIn: true })).toEqual(
        [],
      );
      const chips = visibleBadges(
        { spolecznik: { up: 3 } as BadgeTally },
        {},
        { signedIn: false },
      );
      expect(chips.map((c) => c.state)).toEqual(["public"]);
    });
  });

  describe("publicBadgeIds", () => {
    /** What may leave the person's own page: the „Co nowego” feed cards read
     * this, and the feed is served to anybody. */
    it("returns only what a logged-out visitor would see", () => {
      const ids = publicBadgeIds(
        {
          spolecznik: tally(4), // public without an editor
          omnibus: tally(5), // awaiting one
          "zmiana-barw": tally(1), // a proposal
          "w-czepku-urodzony": tally(3), // approved
          "kot-na-cztery-nogi": tally(9), // hidden
        },
        {
          "w-czepku-urodzony": "approved",
          "kot-na-cztery-nogi": "hidden",
        },
      );

      expect(ids).toEqual(["spolecznik", "w-czepku-urodzony"]);
    });

    it("says nothing about a person nobody has voted on", () => {
      expect(publicBadgeIds({}, {})).toEqual([]);
      expect(publicBadgeIds(undefined, undefined)).toEqual([]);
    });
  });
});
