import {
  mdiAccountGroupOutline,
  mdiAccountOutline,
  mdiBomb,
  mdiDomain,
} from "@mdi/js";
import type { ExtractionFact, ExtractionFactType } from "~~/shared/model";
import { factEdgeRule, type FactEdgeRule } from "~~/shared/factPromotion";

/** Exported so a filter can label the *types* rather than a fact: the chip row
 * on a person's page names every kind of fact that person has, and there is no
 * fact to hand it. `factTypeLabel` below stays the way a card asks. */
export const FACT_TYPE_LABELS: Record<ExtractionFactType, string> = {
  employment: "Zatrudnienie",
  party_membership: "Członkostwo partyjne",
  personal_relation: "Relacja osobista",
  affair_involvement: "Rola w aferze",
};

export const FACT_TYPE_COLORS: Record<ExtractionFactType, string> = {
  employment: "primary",
  party_membership: "secondary",
  personal_relation: "info",
  affair_involvement: "warning",
};

/** What the far end of a fact is, as an icon: an organization, a party, an
 * affair, or another person. */
export const FACT_TYPE_ICONS: Record<ExtractionFactType, string> = {
  employment: mdiDomain,
  party_membership: mdiAccountGroupOutline,
  personal_relation: mdiAccountOutline,
  affair_involvement: mdiBomb,
};

/** Human-readable label for a fact's type (falls back to the raw type). */
export function factTypeLabel(fact: ExtractionFact): string {
  return FACT_TYPE_LABELS[fact.fact_type];
}

/** Vuetify color token for a fact's type. */
export function factTypeColor(fact: ExtractionFact): string {
  return FACT_TYPE_COLORS[fact.fact_type];
}

// --- Edge-style presentation ---
// A fact reads as an edge: source ── connector ──▶ target.

/** Left-hand entity: the person the fact is about (person / relation subject). */
export function factSubject(fact: ExtractionFact): string {
  return fact.person || fact.subject || "—";
}

/** Right-hand entity: organization / party / related person / affair. */
export function factTarget(fact: ExtractionFact): string | undefined {
  if (fact.fact_type === "employment") return fact.organization;
  if (fact.fact_type === "party_membership") return fact.party;
  if (fact.fact_type === "affair_involvement") return fact.affair;
  return fact.object; // personal_relation
}

/** Connector label shown on the arrow between the two entities. */
export function factConnector(fact: ExtractionFact): string {
  if (fact.fact_type === "employment") return fact.role || "zatrudnienie";
  if (fact.fact_type === "party_membership") return "członek";
  if (fact.fact_type === "affair_involvement")
    return fact.role || "rola w aferze";
  return fact.relation || "relacja"; // personal_relation
}

/** Kind caption under the right-hand entity ("" when its type is unknown). */
export function factTargetKind(fact: ExtractionFact): string {
  if (fact.fact_type === "employment") return "organizacja";
  if (fact.fact_type === "party_membership") return "partia";
  if (fact.fact_type === "affair_involvement") return "afera";
  return ""; // personal_relation: the object's type is not asserted
}

// --- Promotion to a relation in the graph ---

// In shared/ so /api/edges/create checks a promotion against the same rule the
// card offers it by.
export { factEdgeRule, type FactEdgeRule };

/** Why a fact cannot be promoted, in the reader's words. Empty when it can. */
export function factPromotionBlocker(fact: ExtractionFact): string {
  if (factEdgeRule(fact)) return "";
  if (!fact.personNodeId) {
    return "Nie wiemy, której osoby w bazie dotyczy ten fakt.";
  }
  if (fact.fact_type === "party_membership") {
    return "Członkostwo partyjne zapisujemy przy osobie, a nie jako powiązanie.";
  }
  return "Dla tego rodzaju faktu nie mamy jeszcze typu powiązania.";
}

// --- What readers have made of a fact ---

/** The three things a reader can say about a fact.
 *
 * „poprawny" and „niepoprawny" are two ends of one vote category; „za mało
 * informacji" is its own, because a reviewer who cannot decide has not thereby
 * said the fact is wrong. Every surface that judges a fact - the review queue,
 * the swipe deck and a person's page - offers exactly these three. */
export type FactVerdict = "correct" | "incorrect" | "insufficient";

/** Where a fact stands with the people who have looked at it. */
export type FactReviewState = "confirmed" | "disputed" | "unreviewed";

/** Read off the aggregate the fact document already carries, which is the
 * whole point: `useVotes` opens a Firestore listener per card, and a person's
 * page mounts every card at once. `Card.vue`'s `reportedWrongPerson` follows
 * the same rule.
 *
 * `correct` is a *sum* of human verdicts (see `computeVoteStats`), so a
 * negative one is a fact readers rejected rather than one nobody has read. Two
 * readers who disagree cancel out to 0 and land back in `unreviewed`, which is
 * the honest answer: the aggregate cannot say more than that people looked and
 * did not settle it.
 */
export function factReviewState(fact: ExtractionFact): FactReviewState {
  const votes = fact.stats?.votes as Record<string, unknown> | undefined;
  const correct = numeric(votes?.correct);
  if (correct < 0 || numeric(votes?.wrongPerson) > 0) return "disputed";
  if (correct > 0) return "confirmed";
  return "unreviewed";
}

/** How many people have voted on this fact.
 *
 * `humanCount` is absent on every aggregate written before the field existed,
 * and `scripts/migrate/backfill-vote-human-count.ts` covered nodes only - so
 * `humanVoted` is the fallback, and one voter is a better answer than none for
 * a fact somebody demonstrably judged.
 */
export function factVoterCount(fact: ExtractionFact): number {
  const votes = fact.stats?.votes;
  const count = votes?.humanCount;
  if (typeof count === "number" && count > 0) return count;
  return votes?.humanVoted ? 1 : 0;
}

/** How many readers have said the fact is about somebody else, off the same
 * aggregate. `computeVoteStats` only writes a category somebody has voted in,
 * so an unflagged fact has no field here at all. */
export function factWrongPersonReports(fact: ExtractionFact): number {
  const votes = fact.stats?.votes as Record<string, unknown> | undefined;
  return numeric(votes?.wrongPerson);
}

/** A vote category is only written once somebody has voted in it, so every
 * read of the aggregate has to survive the field being absent. */
function numeric(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

// --- One claim, several articles ---

/** What a fact claims about its person, field by field and far end first.
 *
 * `person` and `subject` are not among them: who a fact is about is
 * `personNodeId`, settled once at ingest, and the article's spelling of the
 * name is precisely what differs between two articles saying one thing.
 * Partial because the documents come out of a pipeline, and a kind of fact
 * this does not know should stand alone rather than break the list. */
const CLAIM_FIELDS: Partial<
  Record<ExtractionFactType, (keyof ExtractionFact)[]>
> = {
  employment: ["organization", "role"],
  party_membership: ["party"],
  personal_relation: ["object", "relation"],
  affair_involvement: ["affair", "role"],
};

/** One field of a claim, spelled the way two articles would agree on.
 *
 * Only what is typography rather than meaning goes: case, quotation marks and
 * apostrophes („Tak! Dla Polski” and "Tak! Dla Polski", Kukiz'15 and Kukiz15),
 * a dash or hyphen with or without spaces round it (PO-KO, PO – KO), runs of
 * spaces, and a full stop at the end (Wlkp. and Wlkp). Diacritics stay: the
 * model copies them from the article, so two spellings that differ in them
 * came from articles that did too. Nothing is expanded or stemmed - „Urząd
 * m.st. Warszawy” and „Urząd Miasta Stołecznego Warszawa” stay two lines,
 * because telling one office under two names from two offices is a reader's
 * judgement and not a string rule.
 */
export function normalizeClaimField(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .toLocaleLowerCase("pl")
    .replace(/[„”“"«»'’‘`]/g, "")
    .replace(/[\s\-‐‑‒–—]+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "")
    .trim();
}

/** What a fact says about its person, as a string two facts share exactly when
 * they say the same thing - or undefined for a fact that stands on its own.
 *
 * Narrow on purpose, because a wrong merge is worse than a missed one: it puts
 * one article's quote under another article's claim, and a verdict given
 * there would be read as a verdict on both. So the same person, the same kind
 * of fact, and every field the kind is stated in - the role as well as the
 * company, since „prezes” and „wiceprezes” of one company are two facts. Two
 * spellings of one company stay two lines; see `normalizeClaimField`.
 *
 * A fact nobody was matched to stands alone - the same words about two
 * different people are two facts - and so does one without its far end: a
 * „prezes” of two unnamed companies is not one claim.
 */
export function factClaimKey(fact: ExtractionFact): string | undefined {
  if (!fact.personNodeId) return undefined;
  const fields = CLAIM_FIELDS[fact.fact_type];
  if (!fields) return undefined;
  const values = fields.map((field) => normalizeClaimField(fact[field]));
  if (!values[0]) return undefined;
  return JSON.stringify([fact.personNodeId, fact.fact_type, ...values]);
}

/** One article a claim was read from. */
export type FactSource = {
  /** The extraction this article's line is shown and judged through: of the
   * ones below, the one readers have judged most, and otherwise the newest. */
  fact: ExtractionFact;
  /** The same claim taken from the same article again - a second model run
   * over it, or a capture extracted twice. They are one source to a reader,
   * so they are shown as one; a verdict lands on `fact`, and whatever these
   * carry stays theirs. */
  twins: ExtractionFact[];
};

/** One claim about a person, with every article it was read from. */
export type FactGroup = {
  /** Stable for as long as the list is: the claim, or the lone fact's id. */
  key: string;
  /** The fact the line is drawn from - its first source's. */
  fact: ExtractionFact;
  /** In the order the facts came, which is newest first. */
  sources: FactSource[];
};

/** An article's url in the one form two extractions of it agree on: stored
 * with and without a scheme, and with and without a trailing slash. */
function articleKey(fact: ExtractionFact): string {
  return (fact.articleUrl || fact.url || "")
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/\/+$/, "");
}

/** The facts as the claims they make, each with its sources.
 *
 * Order is kept: a claim stands where its newest fact did, and so do its
 * sources inside it, so the endpoint's newest-first order survives. Facts that
 * share no claim with anything come out as groups of one, which is most of
 * them. On the 29 September export 427 of 14,562 matched facts shared one, in
 * 103 claims about 65 people: 57 claims read in two to four articles, and 46
 * read more than once from a single one - among them the 213 copies of two
 * facts a re-run capture left on one person, who goes from 239 cards to 27
 * lines.
 */
export function groupFacts(facts: ExtractionFact[]): FactGroup[] {
  const claims = new Map<string, Map<string, ExtractionFact[]>>();
  facts.forEach((fact, index) => {
    const key = factClaimKey(fact) ?? `fact:${fact.id ?? `${index}`}`;
    let articles = claims.get(key);
    if (!articles) {
      articles = new Map();
      claims.set(key, articles);
    }
    const article = articleKey(fact);
    const same = articles.get(article);
    if (same) same.push(fact);
    else articles.set(article, [fact]);
  });

  return [...claims].map(([key, articles]) => {
    const sources = [...articles.values()].map(toSource);
    return { key, fact: sources[0]!.fact, sources };
  });
}

/** One article's extractions of a claim as the source they are. Stable, so of
 * two facts nobody has judged the newer one is shown. */
function toSource(extractions: ExtractionFact[]): FactSource {
  const [fact, ...twins] = extractions.toSorted(
    (a, b) => factVoterCount(b) - factVoterCount(a),
  );
  return { fact: fact!, twins };
}

/** Where a claim stands with its readers: confirmed once one of its sources
 * is and none is disputed; open while no verdict settles it; disputed only
 * once every source has been rejected.
 *
 * A reader confirming one article's quote and another rejecting a second
 * article's is two readers disagreeing about the claim - „Niepoprawny fakt”
 * says the fact is wrong, not that its article is thin - so the line settles
 * nothing and reads „Bez rozstrzygnięcia”, as a single fact whose votes net
 * to zero already does. No claim on the 29 September export is in that
 * state. */
export function factGroupState(group: FactGroup): FactReviewState {
  const states = group.sources.map((source) => factReviewState(source.fact));
  const confirmed = states.includes("confirmed");
  const disputed = states.includes("disputed");
  if (confirmed && disputed) return "unreviewed";
  if (confirmed) return "confirmed";
  if (states.includes("unreviewed")) return "unreviewed";
  return "disputed";
}

/** How many people have voted on a claim, across the sources it is shown
 * through. */
export function factGroupVoters(group: FactGroup): number {
  return group.sources.reduce(
    (sum, source) => sum + factVoterCount(source.fact),
    0,
  );
}
