/** Odznaki: a closed catalogue of labels readers hand out to people by voting.
 *
 * Proposing somebody for a badge *is* a vote for that badge. There is no
 * separate "suggest" step, because a suggestion nobody else backs is the same
 * thing as a vote of one, and two mechanisms would need two moderation queues
 * for one decision.
 *
 * Nothing in this file may import from "@mdi/js" - or from anything else
 * outside `shared/`. The file is symlinked into `functions/src/badges.ts`, the
 * same trick `stats.ts`, `model.ts` and `qa.ts` already use, and the triggers'
 * `node_modules` has no @mdi/js in it: an icon import would fail their build
 * with TS2307 rather than at runtime, i.e. the next deploy, not the next page
 * load. The emoji are plain strings, which is exactly why they can live here
 * and an mdi path cannot.
 */

/** Marks a `categoryVotes` key as a badge vote rather than one of the five
 * `VoteCategory` axes.
 *
 * A badge vote is stored as a key in the *existing* vote document -
 * `votes/${nodeId}_${uid}`, whose `categoryVotes` is already
 * `Record<string, number>` (shared/model.ts) - and not in a collection of its
 * own. That inherits three things that would otherwise have to be rebuilt: the
 * rule at `ownsVoteTarget` in firestore.rules pins the document id to the caller's uid, so
 * "one person, one vote" is enforced by the same line that enforces it for
 * `interesting`; the aggregation trigger already refires on every write; and a
 * reader's badge votes travel with the rest of their opinion about the person.
 *
 * The prefix carries a colon on purpose. A Firestore map key may not contain a
 * dot (it is the field-path separator, so `stats.badges.a.b` would address a
 * nested map), and `${nodeId}_${uid}` already claims the underscore - a colon
 * is neither, and is what `migration:` uses for the same reason in
 * `isMigrationUid`.
 */
export const BADGE_KEY_PREFIX = "badge:";

/** The `categoryVotes` key a vote for this badge is written under. */
export function badgeKey(id: string): string {
  return `${BADGE_KEY_PREFIX}${id}`;
}

/** Whether a `categoryVotes` key is a badge vote.
 *
 * Every reader of `categoryVotes` that sums, ranks or displays the five vote
 * axes has to ask this and skip: a badge is a different kind of claim on a
 * different scale, and a key nobody recognised would otherwise be summed into
 * the aggregate as if it were a sixth axis (`computeVoteStats` does exactly
 * that with any key it is handed - see the `other: 7` case in
 * tests/shared/stats.test.ts).
 */
export function isBadgeKey(key: string): boolean {
  return key.startsWith(BADGE_KEY_PREFIX);
}

/** The badge id inside a `categoryVotes` key, or "" if the key is not one.
 *
 * The empty string rather than null so the result is always a string and the
 * catalogue lookup can be the thing that rejects it: "" is not a known badge,
 * and `isKnownBadge("")` is false, so a caller that forgot `isBadgeKey` still
 * cannot smuggle a stray key through.
 */
export function badgeIdFromKey(key: string): string {
  return isBadgeKey(key) ? key.slice(BADGE_KEY_PREFIX.length) : "";
}

/** How many different signed-in people, net of the ones who disagree, it takes
 * before a badge is shown to everybody.
 *
 * Three, not one: a single reader's opinion about a person is not something the
 * site should publish under that person's name, and three is the smallest
 * number that cannot be one person with two accounts having a bad afternoon.
 * Net, because the counter-vote has to be able to win - a badge one person
 * proposes and three dispute sits at -2 and never appears.
 *
 * This is a floor, not the whole gate: `requiresApproval` badges also need an
 * editor, see `visibleBadges`.
 */
export const BADGE_PUBLIC_THRESHOLD = 3;

/** The ceiling on how many keys one vote document may carry, for the rule that
 * enforces it.
 *
 * A badge vote adds a key to a map a client can write to directly, so without a
 * cap one script can put ten thousand keys in one document. The cost is not the
 * document: `onVoteWritten` re-reads *every* vote on the node and rewrites the
 * node's `stats`, so a fat map is paid again on every subsequent vote by
 * anybody, forever. Five categories plus five badges is ten keys today, so 40
 * leaves room for the catalogue to quadruple before the rule needs revisiting,
 * and is still four orders of magnitude away from the abuse it exists to stop.
 */
export const MAX_VOTE_KEYS = 40;

/** How much of a badge is a matter of fact and how much a matter of opinion.
 *
 * Shown to the voter, because the three want different standards of evidence:
 * "faktograficzna" is a lookup anybody can repeat and settle, "interpretacyjna"
 * is a reading of the record that two honest people can differ on, and
 * "satyryczna" is a joke with a factual trigger - funny, and still a claim
 * about a named living person, which is why every satirical badge also needs an
 * editor before the public sees it.
 */
export type BadgeSubjectivity =
  "faktograficzna" | "interpretacyjna" | "satyryczna";

export type BadgeDefinition = {
  /** Stable, ASCII, kebab-case. See the comment on `badges` - this id is a
   * Firestore map key in two places at once and may never change. */
  id: string;
  /** A single emoji. A string, not an icon import - see the file header. */
  emoji: string;
  title: string;
  /** What a vote in each direction asserts, in the first person, in one
   * paragraph. The same job `voteCategoryConfig[…].meaning` does for the five
   * axes (app/composables/votes.ts), and for the same measured reason: an alpha
   * tester read the -5..5 arrows as a rating of the page rather than a verdict
   * about the person, because nothing said what the verdict was about. A badge
   * is worse off without it - „Kot na cztery nogi” says nothing at all on its
   * own. */
  claim: string;
  /** What the voter should have looked at before clicking up, and what makes a
   * down vote the right answer. Kept apart from `claim` so the control can show
   * the claim inline and the evidence behind a disclosure. */
  evidence: string;
  subjectivity: BadgeSubjectivity;
  /** Whether an editor has to approve the badge on a person before the public
   * sees it, on top of the vote threshold.
   *
   * True for anything the site would be *characterising* somebody with. False
   * only where the badge states a fact about an institution that happens to
   * attach to a person - „Społecznik” is the seat's own type, and the vote is
   * closer to a data correction than to an opinion. */
  requiresApproval: boolean;
  /** Per-badge override of `BADGE_PUBLIC_THRESHOLD`. None of the five set it;
   * it exists so a badge that turns out to be too cheap can be made dearer
   * without a migration, since the threshold is applied at read time. */
  minVotes?: number;
  /** A badge withdrawn from the catalogue. Still known (`isKnownBadge` is true,
   * so the tally keeps being counted and retiring stays reversible), but it
   * produces no chip and is not offered for voting. */
  retired?: boolean;
};

/** The catalogue. Five badges, in the order the product owner chose, which is
 * also the order they are offered in and the tie-break when two have the same
 * support.
 *
 * # About the ids
 *
 * An id is a Firestore map key in two places at once - `badge:<id>` inside a
 * vote's `categoryVotes`, and `<id>` inside `stats.badges` and
 * `Person.badgeModeration` - so it is constrained by what a field path allows:
 *
 *   - no dot: it separates path segments, so `update("stats.badges.a.b")` would
 *     address a nested map instead of the badge called `a.b`;
 *   - no underscore: `${nodeId}_${uid}` already uses it as a separator and
 *     `ownsVoteTarget` in firestore.rules matches on that shape;
 *   - ASCII only, no Polish letters: the id travels through urls, rule
 *     expressions and log lines, none of which are worth debugging over an „ł”.
 *
 * That leaves kebab-case, which is what these are.
 *
 * **An id never changes.** Not when the title is reworded, not when the emoji
 * is swapped, not to fix a typo in the id itself. Every vote ever cast for a
 * badge is stored under `badge:<id>` in thousands of documents this catalogue
 * cannot rewrite, so renaming an id does not rename those votes - it orphans
 * them, silently, and the badge starts again from zero while the old keys go on
 * being counted as unknown and dropped. A badge that turns out to be wrong is
 * `retired`, and a genuinely different badge gets a new id.
 */
export const badges = [
  {
    id: "kot-na-cztery-nogi",
    emoji: "🐈",
    title: "Kot na cztery nogi",
    subjectivity: "satyryczna",
    requiresApproval: true,
    claim:
      "W górę: ta osoba stanęła do głosowania — wyborów albo referendum — " +
      "mandatu ani wyniku nie uzyskała, a posadę w instytucji publicznej " +
      "objęła w roku tego głosowania albo w następnym. W dół: któraś z tych " +
      "trzech rzeczy się nie zgadza — mandat jednak był, posada jest " +
      "wcześniejsza albo pracodawca nie jest publiczny.",
    evidence:
      "Link do wyniku PKW albo do protokołu komisji referendalnej, z " +
      "nazwiskiem i datą, oraz data objęcia posady z KRS, BIP albo komunikatu " +
      "spółki. Referendum nie występuje w naszych danych ani razu, więc taki " +
      "przypadek zgłosisz wyłącznie ręcznie, ze źródłem.",
  },
  {
    id: "w-czepku-urodzony",
    emoji: "🥄",
    title: "W czepku urodzony",
    subjectivity: "interpretacyjna",
    requiresApproval: true,
    claim:
      "W górę: wskazuję z imienia i nazwiska bliskiego krewnego tej osoby — " +
      "rodzica, małżonka albo rodzeństwo — który sam pełnił funkcję " +
      "publiczną, partyjną albo zasiadał we władzach instytucji publicznej. " +
      "W dół: takiego krewnego nie ma, to tylko zbieżność nazwisk, albo " +
      "źródło mówi o kim innym.",
    evidence:
      "Źródło nazywające pokrewieństwo wprost — wywiad, biogram, rejestr — i " +
      "dowód, że krewny sam pełnił funkcję publiczną. Samo wspólne nazwisko " +
      "jest powodem do głosu w dół, nie w górę. Nigdy o dzieciach i nigdy o " +
      "krewnych, którzy sami nie są osobami publicznymi.",
  },
  {
    id: "omnibus",
    emoji: "🚌",
    title: "Omnibus",
    subjectivity: "interpretacyjna",
    requiresApproval: true,
    claim:
      "W górę: ta osoba pracowała w co najmniej trzech instytucjach " +
      "publicznych z różnych branż, między którymi nie widać związku — inny " +
      "sektor, inna grupa kapitałowa. W dół: to jedna branża pod różnymi " +
      "nazwami albo spółki jednego właściciela.",
    evidence:
      "Trzy posady w historii powiązań, których pracodawcy nie dzielą ani " +
      "branży, ani właściciela. Wystarczy strona osoby; przy wątpliwości " +
      "sprawdź na stronie każdej ze spółek, kto jest jej właścicielem.",
  },
  {
    id: "spolecznik",
    emoji: "🤲",
    title: "Społecznik",
    subjectivity: "faktograficzna",
    // The only badge in the catalogue the public sees without an editor. What
    // it asserts is the type of an organ, not a character trait: a rada
    // społeczna at a SPZOZ is unpaid, and saying so about somebody is a
    // correction to the institution's record that happens to be attached to a
    // person. It is also the one badge whose votes the site *wants* in bulk -
    // 892 seats across 238 hospitals are stored as „Rada Nadzorcza” when they
    // are unpaid rada społeczna seats (shared/companyBodies.ts), and an editor
    // in front of each one would be 892 clicks to learn nothing.
    requiresApproval: false,
    claim:
      "W górę: ta osoba zasiada w organie, za który się nie płaci — na " +
      "przykład w radzie społecznej SPZOZ. W dół: to płatna rada nadzorcza.",
    evidence:
      "Typ instytucji i nazwa organu. 892 miejsca w 238 szpitalach są w " +
      "naszej bazie zapisane jako „Rada Nadzorcza”, a są bezpłatnymi radami " +
      "społecznymi — głos na tę odznakę prostuje właśnie ten błąd.",
  },
  {
    id: "zmiana-barw",
    emoji: "🎨",
    title: "Zmiana barw",
    subjectivity: "interpretacyjna",
    requiresApproval: true,
    claim:
      "W górę: ta osoba startowała z list dwóch różnych ugrupowań, w różnych " +
      "latach, i wskazuję oba komitety z rokiem. W dół: to ten sam obóz pod " +
      "nową nazwą komitetu albo komitet koalicyjny.",
    evidence:
      "Dwie kandydatury z różnych lat z nazwami komitetów, które prowadzą do " +
      "różnych partii. Zmiana partii jest legalna i częsta — odznaka jej nie " +
      "ocenia, tylko odnotowuje.",
  },
] as const satisfies readonly BadgeDefinition[];

/** The catalogue as plain definitions, for reading rather than for typing.
 *
 * `badges` is declared `as const satisfies readonly BadgeDefinition[]`, which
 * is what makes `BadgeId` the union of the five ids instead of `string` - and
 * is also why the optional fields no entry sets are missing from its type
 * altogether: `definition.retired` on the literal type is a TS2339, not
 * `undefined`, and it fails the triggers' `tsc` rather than a test. Anything
 * that reads a field across the whole catalogue goes through this widened view;
 * `badges` stays exported for the id union and for callers that want the
 * literal titles back.
 */
const catalogue: readonly BadgeDefinition[] = badges;

/** The id of a badge that exists. `satisfies` above keeps the literal types, so
 * this is the union of the five strings rather than `string` - a typo in a call
 * site is a compile error, not a chip that never renders. */
export type BadgeId = (typeof badges)[number]["id"];

/** The definition behind an id, or undefined for anything not in the catalogue.
 *
 * A linear scan rather than a prebuilt map: five entries, and the catalogue is
 * a `const` array whose order is meaningful, so a second structure to keep in
 * step with it would cost more than it saves.
 */
export function badgeById(id: string): BadgeDefinition | undefined {
  return catalogue.find((b) => b.id === id);
}

/** Whether an id is in the catalogue.
 *
 * The one gate between what a client can write and what the site will count.
 * `categoryVotes` is a free-form map a signed-in reader writes directly, so
 * `badge:whatever-they-typed` reaches Firestore whatever the UI offers; this is
 * what stops it becoming a counter on a public node document. Retired badges
 * pass, deliberately - their tallies keep being counted so retiring a badge
 * stays reversible, and `visibleBadges` is what stops them rendering.
 */
export function isKnownBadge(id: string): id is BadgeId {
  return badgeById(id) !== undefined;
}

/** The net support this badge needs before the public sees it. */
export function badgeMinVotes(id: string): number {
  return badgeById(id)?.minVotes ?? BADGE_PUBLIC_THRESHOLD;
}

/** How many people said yes and how many said no, one document each.
 *
 * Counts of people, never a sum of values - see `computeBadgeStats` in
 * shared/stats.ts for why that distinction is the whole defence of the
 * feature.
 */
export type BadgeTally = { up: number; down: number };

/** Who can see a badge, and what the chip has to say about itself.
 *
 *   - "public"   - enough support, and approved where approval is required.
 *                  Everybody sees it, logged out included.
 *   - "awaiting" - enough support, but an editor has not looked yet. Signed-in
 *                  readers only, and the chip says it is waiting.
 *   - "proposal" - somebody proposed it and it has not reached the threshold.
 *                  Signed-in readers only, so that the people who can vote can
 *                  see what needs voting on.
 */
export type BadgeState = "public" | "awaiting" | "proposal";

/** One badge as the page renders it: the definition's display fields, the count
 * behind it, and who is allowed to see it.
 *
 * `evidence` and `subjectivity` are deliberately not here. A chip is a word and
 * an emoji; the paragraph that tells a voter what to check belongs to the
 * voting control, which reads the catalogue directly.
 */
export type BadgeChip = {
  id: string;
  emoji: string;
  title: string;
  claim: string;
  up: number;
  down: number;
  support: number;
  state: BadgeState;
};

/** Every badge this reader may see on this person, strongest first.
 *
 * The single place the visibility rule is written down. Every surface - the
 * person page, the „Co nowego” feed cards, the voting control - asks this
 * rather than re-deriving the comparison, because the rule has four outcomes
 * and three of them are indistinguishable from a bug if one caller gets it
 * slightly wrong: a proposal shown to a logged-out visitor is one reader's
 * unreviewed opinion published under a named person's page.
 *
 * In order:
 *
 *   - `badgeModeration[id] === "hidden"` - nobody gets a chip, whatever the
 *     count. An editor's "no" outranks any number of readers; the voting
 *     control still lists the badge, as blocked and without arrows, so that
 *     the same three people do not keep re-proposing it.
 *   - `support <= 0` - no chip. A badge nobody backs, or one the dissenters
 *     have talked down, does not exist. This is also what a withdrawn vote
 *     leaves behind (a stored 0, see the composable) and what a badge that was
 *     voted down to parity looks like.
 *   - `1 <= support < threshold` - "proposal", signed-in only.
 *   - `support >= threshold` and approval satisfied - "public".
 *   - `support >= threshold`, approval required and not given - "awaiting",
 *     signed-in only.
 *
 * Retired badges are skipped outright: they stay in the catalogue so their
 * votes keep their meaning, but the reader is done with them.
 *
 * Tolerant about the tally's shape because it arrives off a Firestore document
 * that anything might have written - a missing `down` reads as 0 rather than
 * turning `support` into NaN, which would compare false against every threshold
 * and make the badge silently vanish instead of loudly failing.
 */
export function visibleBadges(
  tallies: Record<string, BadgeTally> | undefined | null,
  moderation: Record<string, "approved" | "hidden"> | undefined | null,
  options: { signedIn: boolean },
): BadgeChip[] {
  const chips: { chip: BadgeChip; order: number }[] = [];

  // Iterating the catalogue rather than the tallies does three jobs at once:
  // an unknown key on the document cannot produce a chip, the catalogue's order
  // is available as the tie-break, and a badge with no tally at all needs no
  // special case.
  catalogue.forEach((definition, order) => {
    if (definition.retired) return;

    const decision = moderation?.[definition.id];
    if (decision === "hidden") return;

    const tally = tallies?.[definition.id];
    const up = Number(tally?.up) || 0;
    const down = Number(tally?.down) || 0;
    const support = up - down;
    if (support <= 0) return;

    let state: BadgeState;
    if (support < badgeMinVotes(definition.id)) {
      state = "proposal";
    } else if (!definition.requiresApproval || decision === "approved") {
      state = "public";
    } else {
      state = "awaiting";
    }

    if (state !== "public" && !options.signedIn) return;

    chips.push({
      chip: {
        id: definition.id,
        emoji: definition.emoji,
        title: definition.title,
        claim: definition.claim,
        up,
        down,
        support,
        state,
      },
      order,
    });
  });

  // Most-supported first, catalogue order on a tie. The tie-break is explicit
  // rather than leaning on sort stability: it is what makes the order of two
  // badges on a person reproducible, and a reproducible order is what keeps the
  // feed cards and the visual baselines from flapping.
  chips.sort((a, b) => b.chip.support - a.chip.support || a.order - b.order);

  return chips.map((entry) => entry.chip);
}

/** The badges a logged-out visitor sees on this person.
 *
 * This is what may leave the person's own page - the „Co nowego” feed cards on
 * the home page read it, and the feed is served to anybody. Asking
 * `visibleBadges` with `signedIn: false` rather than re-implementing the test
 * means the feed cannot drift from the page: one rule, one place, and a change
 * to the threshold moves both.
 *
 * Badges never go into `og:title`, `og:description`, `useSeoMeta` or the
 * sitemap, however public they are. A chip is a reader's verdict on a named
 * person, and syndicating it into a search result or a link preview puts it in
 * front of people who never saw the vote count next to it - and outlives being
 * hidden, because a crawler's copy is not ours to withdraw.
 */
export function publicBadgeIds(
  tallies: Record<string, BadgeTally> | undefined | null,
  moderation: Record<string, "approved" | "hidden"> | undefined | null,
): string[] {
  return visibleBadges(tallies, moderation, { signedIn: false })
    .filter((chip) => chip.state === "public")
    .map((chip) => chip.id);
}
