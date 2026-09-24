import type { Person, Company, Article, Region, Topic } from "~~/shared/model";
import { displayRole } from "~~/shared/companyBodies";
import { longDate } from "~~/shared/dates";
import { relationsPlural, type EdgeNode } from "~/composables/edges";
import { polishCounting } from "~/composables/polish";

export type EntityNode = Person | Company | Article | Region | Topic;

/** Where a link preview and a search result both stop reading. Going over does
 * not break anything, it just gets cut - and cut by them lands mid-word. */
const DESCRIPTION_LIMIT = 160;

/** The card a social platform draws is the only thing most people ever see of a
 * page. Without an image it renders as a bare link, so every entity page points
 * at the site card rather than at nothing. */
export const SOCIAL_CARD = "/social-card.png";

export function truncateDescription(
  text: string,
  limit: number = DESCRIPTION_LIMIT,
): string {
  if (text.length <= limit) return text;
  // Cut on a word boundary, unless the first word is already longer than the
  // budget - an article headline can be one unbroken url.
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[\s,.:;-]+$/, "")}…`;
}

/** What the link preview says under the title, and what a search result shows
 * under the link - when the search engine takes it.
 *
 * `relationCount` is what the page itself is showing, so the description
 * promises what the visitor will actually find. A node with nothing attached to
 * it yet says so by omission rather than advertising "0 powiązań".
 *
 * `edges` are those relations as rows, where the caller has them. A person or a
 * company then gets its facts instead of the stock sentence: who sits on the
 * board and for which party, where somebody holds a post now. Google passed
 * over the stock sentence, which read the same on every company page, and
 * quoted the page instead - "Obecny skład" run together into "Zarząd1 osoba.
 * RB. Romuald BosakowskiPO." Names are also what people search for: nearly
 * every search that is not for the site itself is for a person or a company.
 */
export function entityDescription(
  entity: EntityNode,
  relationCount = 0,
  edges: readonly EdgeNode[] = [],
): string {
  const relations =
    relationCount > 0
      ? `${relationCount} ${relationsPlural(relationCount)}`
      : undefined;

  switch (entity.type) {
    case "person": {
      const facts = compose(
        withParties(entity.name, entity.parties),
        personClauses(edges),
      );
      if (facts) return facts;
      const parties = entity.parties?.length
        ? ` (${entity.parties.join(", ")})`
        : "";
      const lead = `${entity.name}${parties} w bazie koryciarstwa`;
      return truncateDescription(
        relations
          ? `${lead}: ${relations}, historia zatrudnienia w spółkach publicznych i starty w wyborach.`
          : `${lead}. Sprawdź historię zatrudnienia w spółkach publicznych i starty w wyborach.`,
      );
    }
    case "place": {
      const facts = compose(oneLine(entity.name), placeClauses(entity, edges));
      if (facts) return facts;
      return truncateDescription(
        relations
          ? `Kto pracuje i pracował w ${entity.name}? ${relations} z osobami publicznymi, zebrane ze źródeł jawnych.`
          : `Kto pracuje i pracował w ${entity.name}? Powiązania z osobami publicznymi, zebrane ze źródeł jawnych.`,
      );
    }
    case "region":
      return truncateDescription(
        `Koryciarstwo w regionie ${entity.name}: kto z lokalnej władzy zasiada w spółkach publicznych i instytucjach.`,
      );
    case "article":
      return truncateDescription(
        relations
          ? `Osoby i instytucje wymienione w tym artykule - ${relations} w bazie Koryta.pl.`
          : `Artykuł w bazie Koryta.pl. Sprawdź, kogo wymienia i jak te osoby łączą się ze spółkami publicznymi.`,
      );
    case "topic":
      // The topic's own words when it has any: a story is the one kind of page
      // here whose description is written rather than derived.
      return truncateDescription(
        entity.description ||
          `${entity.name} - kto jest w tej sprawie i jak te osoby są ze sobą powiązane, na podstawie artykułów w bazie Koryta.pl.`,
      );
  }
}

/** One sentence of a description: a heading and the names it lists. */
type Clause = {
  head: string;
  items: string[];
  /** Said after a list of one where there is room for it: when the post
   * began, or what a former one was. Given up before any of the names are. */
  tail?: string;
  /** What stands in for the names that did not fit: "jeszcze 3 osoby". */
  rest: (left: number) => string;
};

/** The lead, then as many clauses as fit behind it.
 *
 * Stops at the first clause that does not fit rather than skipping ahead to a
 * shorter one, so the description keeps the page's order - the board before the
 * people who used to sit on it. Nothing at all when not even the first clause
 * fits: the stock sentence says more than a bare name.
 */
function compose(lead: string, clauses: Clause[]): string | undefined {
  let text = sentence(lead);
  let added = 0;
  for (const clause of clauses) {
    const fitted = fitClause(clause, DESCRIPTION_LIMIT - text.length - 1);
    if (!fitted) break;
    text = `${text} ${fitted}`;
    added++;
  }
  return added ? text : undefined;
}

/** The longest form of the clause that fits in `room` characters.
 *
 * Names come off the end of the list and are counted rather than cut: "i
 * jeszcze 3 osoby" tells the reader there is more on the page, where the search
 * engine's own ellipsis would stop in the middle of a surname.
 */
function fitClause(
  { head, items, tail, rest }: Clause,
  room: number,
): string | undefined {
  const forms = [`${head}${items.join(", ")}`];
  if (tail) forms.unshift(`${head}${items.join(", ")}${tail}`);
  for (let kept = items.length - 1; kept >= 1; kept--) {
    const left = items.length - kept;
    forms.push(`${head}${items.slice(0, kept).join(", ")} i ${rest(left)}`);
  }
  return forms.map(sentence).find((form) => form.length <= room);
}

/** Ends a sentence, unless it already ends on a stop - "Orlen S.A." would
 * otherwise end on two. */
function sentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** A name on one line. The register's own can carry a line break - one
 * hospital's is two lines long - which a page lays out as a space and a
 * description would keep. */
function oneLine(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** A name as the page prints it beside its party chips. */
function withParties(name: string, parties?: readonly string[]): string {
  const named = oneLine(name);
  return parties?.length ? `${named} (${parties.join(", ")})` : named;
}

/** What a lone former post was, for a list with room to say so: ", Zarząd
 * 2011–2012". Years only - the page prints the days. */
function formerSpell(
  role: string | undefined,
  edge: EdgeNode,
): string | undefined {
  const from = edge.start_date?.slice(0, 4);
  const to = edge.end_date?.slice(0, 4);
  const years =
    from && to ? (from === to ? from : `${from}–${to}`) : to && `do ${to}`;
  const said = [role, years].filter(Boolean).join(" ");
  return said ? `, ${said}` : undefined;
}

function nodeKey(edge: EdgeNode): string {
  return edge.richNode.id ?? edge.richNode.name;
}

/** Latest first by the date `on` reads, undated last. */
function latest(on: (edge: EdgeNode) => string | undefined) {
  return (a: EdgeNode, b: EdgeNode) => (on(b) ?? "").localeCompare(on(a) ?? "");
}

/** One relation per far end: somebody with three spells on one board is still
 * one name in a list of who sat on it. */
function onePerNode(edges: EdgeNode[]): EdgeNode[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = nodeKey(edge);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const morePeople = (n: number) =>
  `jeszcze ${polishCounting(n, "osoba", "osoby", "osób")}`;

/** The order "Obecny skład" draws the organs in - the board that runs the
 * company, then the ones supervising it. `ROLE_ORDER` in
 * succession/CompanyChanges.vue. */
const ORGAN_ORDER = ["zarząd", "rada nadzorcza", "rada społeczna"];

function organRank(role: string): number {
  const at = ORGAN_ORDER.indexOf(role.toLocaleLowerCase("pl"));
  return at === -1 ? ORGAN_ORDER.length : at;
}

/** A company: who holds each post now and for which party, organ by organ,
 * then who used to. "Now" is a post with no end date, which is what "Obecny
 * skład" means by it too. */
function placeClauses(company: Company, edges: readonly EdgeNode[]): Clause[] {
  const posts = edges.filter(
    (e) => e.type === "employed" && e.richNode.type === "person",
  );
  const current = posts
    .filter((e) => !e.end_date)
    .toSorted(latest((e) => e.start_date));

  const organs = new Map<string, { role: string; held: EdgeNode[] }>();
  for (const post of current) {
    const named = displayRole(post.name, company) ?? "Inne funkcje";
    // A heading: "pracuje" is stored lower case, "Zarząd" is not.
    const role = named.charAt(0).toLocaleUpperCase("pl") + named.slice(1);
    const key = role.toLocaleLowerCase("pl");
    const organ = organs.get(key);
    if (organ) organ.held.push(post);
    else organs.set(key, { role, held: [post] });
  }

  const clauses = [...organs.values()]
    .toSorted((a, b) => organRank(a.role) - organRank(b.role))
    .map(({ role, held }): Clause => {
      const [only] = held;
      return {
        head: `${role}: `,
        items: held.map((e) =>
          withParties(e.richNode.name, (e.richNode as Person).parties),
        ),
        tail:
          held.length === 1 && only?.start_date
            ? `, od ${longDate(only.start_date)}`
            : undefined,
        rest: morePeople,
      };
    });

  const seated = new Set(current.map(nodeKey));
  const former = onePerNode(
    posts
      .filter((e) => e.end_date && !seated.has(nodeKey(e)))
      .toSorted(latest((e) => e.end_date)),
  );
  if (former.length) {
    const [only] = former;
    clauses.push({
      head: current.length ? "Wcześniej: " : "Dawniej: ",
      items: former.map((e) =>
        withParties(e.richNode.name, (e.richNode as Person).parties),
      ),
      tail:
        former.length === 1 && only
          ? formerSpell(displayRole(only.name, company), only)
          : undefined,
      rest: morePeople,
    });
  }
  return clauses;
}

/** A person: the posts they hold now, where they held one before, and where
 * they stood for election. The parties are already in the lead. */
function personClauses(edges: readonly EdgeNode[]): Clause[] {
  const clauses: Clause[] = [];
  const posts = edges.filter(
    (e) => e.type === "employed" && e.richNode.type === "place",
  );

  const current = posts
    .filter((e) => !e.end_date)
    .toSorted(latest((e) => e.start_date));
  if (current.length) {
    const [only] = current;
    clauses.push({
      head: "Obecnie: ",
      items: current.map((e) => {
        const role = displayRole(e.name, e.richNode as Company);
        const where = oneLine(e.richNode.name);
        return role ? `${role} w ${where}` : where;
      }),
      tail:
        current.length === 1 && only?.start_date
          ? `, od ${longDate(only.start_date)}`
          : undefined,
      rest: (n) =>
        `jeszcze ${polishCounting(n, "stanowisko", "stanowiska", "stanowisk")}`,
    });
  }

  const named = new Set(current.map(nodeKey));
  const former = onePerNode(
    posts
      .filter((e) => e.end_date && !named.has(nodeKey(e)))
      .toSorted(latest((e) => e.end_date)),
  );
  if (former.length) {
    const [only] = former;
    clauses.push({
      head: "Wcześniej: ",
      items: former.map((e) => oneLine(e.richNode.name)),
      tail:
        former.length === 1 && only
          ? formerSpell(displayRole(only.name, only.richNode as Company), only)
          : undefined,
      rest: (n) =>
        `jeszcze ${polishCounting(n, "instytucja", "instytucje", "instytucji")}`,
    });
  }

  // Where rather than which office: the ballot's far end is the council or
  // the constituency, and the stored name of the relation is just
  // "kandydatura". Latest election first, each place's years in order.
  const ballots = new Map<string, Set<string>>();
  const candidacies = edges
    .filter((e) => e.type === "election" && e.start_date)
    .toSorted(latest((e) => e.start_date));
  for (const e of candidacies) {
    const where = oneLine(e.richNode.name);
    const years = ballots.get(where) ?? new Set<string>();
    years.add(e.start_date!.slice(0, 4));
    ballots.set(where, years);
  }
  if (ballots.size) {
    clauses.push({
      head: "Starty w wyborach: ",
      items: [...ballots].map(
        ([where, years]) => `${where} (${[...years].toSorted().join(", ")})`,
      ),
      rest: (n) =>
        `jeszcze ${polishCounting(n, "miejsce", "miejsca", "miejsc")}`,
    });
  }
  return clauses;
}

/** og:type, which is what decides whether a platform files the link as a story
 * or as a profile. */
export function entityOgType(
  entity: EntityNode,
): "article" | "profile" | "website" {
  switch (entity.type) {
    case "article":
      return "article";
    case "person":
      return "profile";
    default:
      return "website";
  }
}
