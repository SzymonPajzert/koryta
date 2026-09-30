/** People the article facts name who have no page of their own.
 *
 * „Dobrze jakby dało się również wyszukiwać po osobach z tych faktów nawet
 * jeśli nie mają koryta id. Na przykład Piotr Ferster” - said on Rafał
 * Trzaskowski's page, three of whose facts name his half-brother. Nothing in
 * the graph carries that name: the ingest only ever resolves a fact's subject
 * (`personNodeId`), and the other person in a relation is left as the string
 * the article used. So the search box could not find him, though a signed in
 * reader could scroll past him on the page.
 *
 * Everything here is pure, so the server's index (`server/utils/factNames.ts`),
 * the search box and the person's page all read a name the same way.
 */

import type { ExtractionFact } from "./model";
import { normalizePersonName } from "./names";
import { nameMatchesTokens, searchTokens } from "./search";

/** What the index reads off a fact - the fields `/api/search/facts` asks
 * Firestore for, and no more. */
export type FactNameSource = Pick<
  ExtractionFact,
  | "fact_type"
  | "person"
  | "subject"
  | "object"
  | "personNodeId"
  | "personNodeName"
  | "articleUrl"
  | "articleDomain"
>;

/** Lowercase words that may stand inside a name without ending it -
 * „Ursula von der Leyen” is in the facts, and so are a few more like her. */
const NAME_PARTICLES = new Set([
  "al",
  "ben",
  "bin",
  "da",
  "das",
  "de",
  "del",
  "della",
  "den",
  "der",
  "di",
  "dos",
  "du",
  "el",
  "la",
  "le",
  "ten",
  "ter",
  "van",
  "von",
  "zu",
]);

/** A capitalised word of two letters or more, hyphenated parts included:
 * „Brzezińska-Hołownia”, „O'Neill”, and a register's „KOWALSKI”. */
const NAME_WORD = /^\p{Lu}[\p{L}'’]+(?:[-–]\p{Lu}[\p{L}'’]+)*$/u;

/** A middle initial, „Szymon Ł. Różański”. */
const MIDDLE_INITIAL = /^\p{Lu}\.$/u;

/** Whether `raw` reads as somebody's full name.
 *
 * The prompt asks for a full name and mostly gets one, but not always, and
 * what slips through is not worth a search result. On the 2026-09-29 export
 * this turns away 122 of the 604 names the index reads:
 *
 * - 95 with an initial for a surname („Tomasz S.”, „Radosław Sz.”). The press
 *   writes a suspect that way on purpose, and one entry would pool every
 *   Tomasz S. in every article into one person who does not exist;
 * - 22 relations or roles in place of a name („żona Marcina Liberackiego”,
 *   „prezes”, „posłowie PSL”, „dr hab. Marek Leśniak”);
 * - 4 first names alone („Anna”, „Zosia”), and one „senior”.
 *
 * Two to five words, each capitalised. The particles above and a middle
 * initial may stand between them, but not at either end: a name ending in an
 * initial is exactly the anonymised kind.
 */
export function isSearchableName(raw: string | undefined): raw is string {
  if (!raw) return false;
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return words.every(
    (word, i) =>
      NAME_WORD.test(word) ||
      (i > 0 &&
        i < words.length - 1 &&
        (NAME_PARTICLES.has(word) || MIDDLE_INITIAL.test(word))),
  );
}

/** The key two spellings of one name share.
 *
 * `normalizePersonName` takes care of case, diacritics and hyphens - „Łukasz
 * Żuk”, „LUKASZ ZUK” - and the words are sorted on top of that, so a list that
 * prints the surname first („Ferster Piotr”) lands on the same entry. Empty
 * for something that is not a name at all.
 */
export function factNameKey(name: string): string {
  return normalizePersonName(name).split(" ").filter(Boolean).sort().join(" ");
}

/** The names on `fact` that no page was matched to.
 *
 * The other person in a relation always, because the ingest only matches a
 * fact's subject. The subject too, where it matched nobody - that is a fact
 * from an article whose people are not in the graph. Only what reads as a full
 * name (`isSearchableName`).
 */
export function unmatchedNames(fact: FactNameSource): string[] {
  const names: string[] = [];
  if (fact.fact_type === "personal_relation") names.push(fact.object ?? "");
  // `person || subject`, the pair the ingest matches on and `factSubject`
  // shows on the card.
  if (!fact.personNodeId) names.push(fact.person || fact.subject || "");
  return names.filter(isSearchableName).map((name) => name.trim());
}

/** Whether `fact` names the person `key` stands for, in any of its slots.
 *
 * What a person's page filters its facts by when it is opened from the search
 * box - `?fakty=Piotr Ferster` - so a name is found there however the
 * article spelled it. */
export function factNamesPerson(fact: FactNameSource, key: string): boolean {
  if (!key) return false;
  return [fact.person, fact.subject, fact.object].some(
    (name) => !!name && factNameKey(name) === key,
  );
}

/** A person's page whose facts name somebody. */
export type FactNamePerson = { id: string; name: string; facts: number };

/** An article whose facts name somebody, where no page carries them. */
export type FactNameArticle = { url: string; domain: string; facts: number };

/** One name, and everywhere the facts put it. */
export type FactNameEntry = {
  key: string;
  /** The spelling the facts use most. */
  name: string;
  /** `name` folded for matching - lowercase, no diacritics. */
  folded: string;
  /** How many facts name them. */
  facts: number;
  /** Pages whose facts name them, most facts first. That is where a reader
   * sees the name today: the other person in a relation on a person's page. */
  people: FactNamePerson[];
  /** Articles whose facts name them and are matched to nobody - what
   * /ekstrakcje?article= lists. Most facts first. */
  articles: FactNameArticle[];
};

/** Every spelling of every name the index would carry, for checking against
 * the graph before it is built - a name somebody has a page under is the
 * people search's to find, not this one's. */
export function candidateSpellings(facts: FactNameSource[]): string[] {
  return [...new Set(facts.flatMap(unmatchedNames))];
}

/** The index: every unmatched name in `facts`, with where it is mentioned.
 *
 * `taken` holds the keys of names that have a page - found by the server in
 * the graph. The facts add some of their own: a name the ingest matched to a
 * page anywhere is somebody the graph has, even where a later article left
 * them unmatched.
 *
 * `pages` is what the graph says today about the subjects the facts were
 * matched to, by node id: the page's current name, or null for a page that
 * is gone - removed, or merged into another. The name is what the link's
 * slug is built from, so a page renamed since the ingest is linked without a
 * redirect; a gone page is not linked at all, and the fact falls back to its
 * article. Without `pages` the name the fact stored is used.
 */
export function buildFactNameIndex(
  facts: FactNameSource[],
  taken: ReadonlySet<string> = new Set(),
  pages?: ReadonlyMap<string, string | null>,
): FactNameEntry[] {
  const matched = new Set(taken);
  for (const fact of facts) {
    if (fact.personNodeName) matched.add(factNameKey(fact.personNodeName));
  }

  type Building = {
    spellings: Map<string, number>;
    facts: number;
    people: Map<string, FactNamePerson>;
    articles: Map<string, FactNameArticle>;
  };
  const byKey = new Map<string, Building>();

  for (const fact of facts) {
    for (const name of new Set(unmatchedNames(fact))) {
      const key = factNameKey(name);
      if (!key || matched.has(key)) continue;

      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          spellings: new Map(),
          facts: 0,
          people: new Map(),
          articles: new Map(),
        };
        byKey.set(key, entry);
      }
      entry.facts++;
      entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);

      // The subject's page when there is one - that is where the fact is on
      // show, the object of a relation on the page of its subject. Otherwise
      // the article, which is all an unmatched fact belongs to.
      const page = fact.personNodeId
        ? pages
          ? pages.get(fact.personNodeId)
          : (fact.personNodeName ?? "")
        : undefined;
      if (fact.personNodeId && typeof page === "string") {
        const person = entry.people.get(fact.personNodeId) ?? {
          id: fact.personNodeId,
          name: page,
          facts: 0,
        };
        person.facts++;
        entry.people.set(fact.personNodeId, person);
      } else if (fact.articleUrl) {
        const article = entry.articles.get(fact.articleUrl) ?? {
          url: fact.articleUrl,
          domain: fact.articleDomain || domainOf(fact.articleUrl),
          facts: 0,
        };
        article.facts++;
        entry.articles.set(fact.articleUrl, article);
      }
    }
  }

  return [...byKey.entries()].map(([key, entry]) => {
    const name = favouriteSpelling(entry.spellings);
    return {
      key,
      name,
      folded: normalizePersonName(name),
      facts: entry.facts,
      people: [...entry.people.values()].sort(
        (a, b) => b.facts - a.facts || a.name.localeCompare(b.name, "pl"),
      ),
      articles: [...entry.articles.values()].sort(
        (a, b) => b.facts - a.facts || a.url.localeCompare(b.url),
      ),
    };
  });
}

/** The names that answer `query`, best first.
 *
 * The rule the people search goes by - every typed word the start of a
 * different word of the name, in any order (`nameMatchesTokens`) - but with
 * diacritics folded on both sides, which the Firestore index cannot do and an
 * index held in memory can: „zmudzka” finds Żmudzka.
 *
 * A name that starts with the whole query comes first, then the names the
 * facts mention most.
 */
export function searchFactNames(
  index: FactNameEntry[],
  query: string,
  limit: number,
): FactNameEntry[] {
  const tokens = searchTokens(normalizePersonName(query));
  if (tokens.length === 0) return [];
  const typed = tokens.join(" ");
  const startsWith = (entry: FactNameEntry) =>
    entry.folded.startsWith(typed) ? 0 : 1;

  return index
    .filter((entry) => nameMatchesTokens(entry.folded, tokens))
    .sort(
      (a, b) =>
        startsWith(a) - startsWith(b) ||
        b.facts - a.facts ||
        a.name.localeCompare(b.name, "pl"),
    )
    .slice(0, limit);
}

/** How many places a search result names before it says „i jeszcze N
 * innych”. Two, because the line sits under a name in a menu that is a phone's
 * width on a phone. */
export const FACT_NAME_PLACES = 2;

/** One search result, as `/api/search/facts` sends it. */
export type FactNameHit = {
  name: string;
  facts: number;
  people: FactNamePerson[];
  /** People whose pages also name them, past the ones listed. */
  morePeople: number;
  articles: FactNameArticle[];
  /** Articles past the ones listed. */
  moreArticles: number;
};

/** An index entry cut down to what the search box shows. */
export function toFactNameHit(entry: FactNameEntry): FactNameHit {
  return {
    name: entry.name,
    facts: entry.facts,
    people: entry.people.slice(0, FACT_NAME_PLACES),
    morePeople: Math.max(0, entry.people.length - FACT_NAME_PLACES),
    articles: entry.articles.slice(0, FACT_NAME_PLACES),
    moreArticles: Math.max(0, entry.articles.length - FACT_NAME_PLACES),
  };
}

/** The spelling most facts use; on a tie the one with more diacritics, since
 * a newsroom's CMS drops them and never adds any. */
function favouriteSpelling(spellings: Map<string, number>): string {
  const marks = (name: string) =>
    [...name].filter((char) => char.charCodeAt(0) > 127).length;
  return [...spellings.entries()].sort(
    ([a, countA], [b, countB]) =>
      countB - countA || marks(b) - marks(a) || a.localeCompare(b, "pl"),
  )[0]![0];
}

/** `rmf24.pl` out of `https://www.rmf24.pl/...` or `rmf24.pl/...` - the
 * pipeline sends both shapes. */
function domainOf(url: string): string {
  return url
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]!;
}
