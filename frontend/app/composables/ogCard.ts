/** What goes on the picture a platform draws when somebody shares a person or
 * an institution.
 *
 * Every page used to point `og:image` at `/social-card.png`, so a link to
 * Rafał Trzaskowski and a link to the front page unfurled as the same banner.
 * These builders turn what the page already loaded into the flat props
 * `OgImage/NodeCard.satori.vue` draws.
 *
 * Why the logic is here and not in the template: the card is Polish prose with
 * three-form declension in it, and the template is rendered by satori inside a
 * nitro route that no test mounts. A pluralisation rule that lives in a `.vue`
 * file nobody can call is how „2 powiązań” ships. Everything below is pure -
 * `now` is an argument - so `tests/composables/ogCard.test.ts` can walk every
 * rung of both ladders against plain objects.
 *
 * Two rules hold across both cards:
 *
 * - **Nothing is read from `node.stats`.** `stats` is in `INTERNAL_FIELDS`
 *   (server/utils/revisions.ts), so a signed-in editor's `latest=true` response
 *   does not carry it and their card would disagree with the crawler's. Every
 *   figure here is recomputed from the edges the visitor can recount on the
 *   page they land on.
 * - **Nothing states a verdict.** No finite verb appears on either card, which
 *   is also why no gender ever has to be generated for a name the site holds no
 *   gender for. A board seat is a fact; the card reports it and stops.
 */
import type { Company, Person } from "~~/shared/model";
import { asArray, publicSectorKnown } from "~~/shared/model";
import { displayRole } from "~~/shared/companyBodies";
import { categoryTitle } from "~~/shared/companyCategories";
import { companyIdentifiers } from "~~/shared/identifiers";
import { partyColors } from "~~/shared/misc";
import { readableInkOn } from "~~/shared/colors";
import { truncateDescription } from "~/composables/entitySeo";
import { polishCounting, polishNoun } from "~/composables/polish";
import { edgeCompany, edgePerson, type EdgeNode } from "~/composables/edges";

/** The flat prop bag `NodeCard.satori.vue` takes.
 *
 * Scalars rather than one object on purpose: nuxt-og-image base64s an *object*
 * prop into a single URL path segment, while scalars encode per key, which
 * keeps the URL readable in a log and well inside any length limit.
 *
 * `name` is deliberately not called `title`: the module injects the page
 * `<title>` into a prop literally named `title` when it is left undefined, so a
 * slip in the eligibility gate would stamp „Strona nieznaleziona” on the card.
 */
export interface NodeCardProps {
  name: string;
  /** Already uppercased - „OSOBA”, „SZPITALE”, „INSTYTUCJA”. */
  eyebrow: string;
  chipLabel: string;
  /** `""` means the chip is drawn as an outline: no `background-color` at all. */
  chipFill: string;
  chipInk: string;
  chipRule: string;
  /** One of 72 / 58 / 46 / 38 / 32. */
  nameSize: number;
  /** `""` suppresses the fact line entirely. */
  fact: string;
  foot: string;
  /** Numerals as strings; `""` means the cell is absent. Cells pack from the
   * first: there is never a gap between two filled ones. */
  stat1Value: string;
  stat1Label: string;
  stat2Value: string;
  stat2Label: string;
  stat3Value: string;
  stat3Label: string;
}

export interface PersonCardInput {
  person: Person;
  /** Edges pointing away from this person: employment, candidacies. */
  targets: EdgeNode[];
  /** Both directions, for the relations a person is on the receiving end of. */
  edges: EdgeNode[];
  now?: Date;
}

export interface CompanyCardInput {
  company: Company;
  /** Edges pointing *at* the institution - its board arrives this way. */
  sources: EdgeNode[];
  /** `owns`/`seat` edges pointing at it: shareholders, and the seat region. */
  owners: EdgeNode[];
  subsidiaryCount: number;
  location?: string;
  now?: Date;
}

/** How long a name may be before the card would rather ellipsize than shrink
 * further. Past this the 32px tier plus a two-line clamp is doing the work. */
const NAME_LIMIT = 120;

/** A stat cell before it is flattened into the numbered props. */
type Stat = { value: number; label: string };

/** „wrzesień 2026”.
 *
 * Month granularity, not a day: the image URL is a pure function of these
 * props, so a day stamp would mint a fresh URL - and a fresh render - every
 * night for every page on the site, for a line nobody reads twice.
 */
export function baseAsOfLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("pl-PL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
}

/** The type size a name gets, by how much of it there is. Paired with the
 * template's two-line clamp, this is what keeps „SAMODZIELNY PUBLICZNY ZAKŁAD
 * OPIEKI ZDROWOTNEJ W MIŃSKU MAZOWIECKIM” on the card. */
function nameSizeFor(name: string): number {
  if (name.length <= 22) return 72;
  if (name.length <= 44) return 58;
  if (name.length <= 66) return 46;
  if (name.length <= 86) return 38;
  return 32;
}

/** Sorts by a date string, newest first, with a missing date sorting last.
 * The dates are ISO-ish and compared as text, which is what the rest of the
 * site does with them. */
function byDateDesc(key: "start_date" | "end_date") {
  return (a: EdgeNode, b: EdgeNode) =>
    String(b[key] ?? "").localeCompare(String(a[key] ?? ""));
}

/** An employment spell counts as current only when it has no end date at all.
 *
 * Strictly `!end_date`, matching `card/Employment.vue`. The crawl stamps an
 * end date on a post the moment it stops seeing it in the register, and 205 of
 * them share a single date - so a laxer test would put „Obecnie” on the card
 * for a seat the page itself draws as finished. Understating is the only
 * direction this may err in. */
function isCurrent(edge: EdgeNode): boolean {
  return !edge.end_date;
}

/** Packs up to three stats into the numbered props, dropping the empty ones. */
function statProps(
  stats: Stat[],
): Pick<
  NodeCardProps,
  | "stat1Value"
  | "stat1Label"
  | "stat2Value"
  | "stat2Label"
  | "stat3Value"
  | "stat3Label"
> {
  const kept = stats.filter((s) => s.value >= 1).slice(0, 3);
  const at = (i: number) => kept[i];
  return {
    stat1Value: at(0) ? String(at(0)!.value) : "",
    stat1Label: at(0)?.label ?? "",
    stat2Value: at(1) ? String(at(1)!.value) : "",
    stat2Label: at(1)?.label ?? "",
    stat3Value: at(2) ? String(at(2)!.value) : "",
    stat3Label: at(2)?.label ?? "",
  };
}

/** „Rada Społeczna · SPZOZ w Mińsku Mazowieckim”, or just the institution.
 *
 * `edge.name` and never `edge.label`: `useEdges` falls `label` back to the edge
 * type's phrase, so a post with no title of its own would print „Zatrudniony/a
 * w” where a job title goes. `displayRole` is what rewrites a stored „Rada
 * Nadzorcza” to „Rada Społeczna” on an SPZOZ, which is the difference between
 * reporting a statutory advisory council and asserting a paid supervisory
 * board. */
function postPhrase(edge: EdgeNode): string {
  const role = displayRole(edge.name, edgeCompany(edge));
  const institution = truncateDescription(edge.richNode.name, 46);
  return role ? `${role} · ${institution}` : institution;
}

export function personCardProps(input: PersonCardInput): NodeCardProps {
  const { person, targets, edges } = input;

  const employed = targets.filter((e) => e.type === "employed");
  const employedPlace = employed.filter((e) => !!edgeCompany(e));
  const employedPublic = employedPlace.filter(
    (e) => edgeCompany(e)!.isPublic === true,
  );
  const current = employed.filter(isCurrent);
  const currentPublic = employedPublic.filter(isCurrent);
  const elections = edges.filter(
    (e) => e.type === "election" && !!e.richNode.name,
  );
  const publicEmployers = new Set(employedPublic.map((e) => e.target)).size;
  const parties = asArray(person.parties).filter(Boolean);

  // A party the site holds is a party *in the database*, which is a weaker
  // claim than membership and is hedged in the label rather than left to be
  // read off a bare „PO”. Two parties get no fill: one colour cannot honestly
  // stand for both.
  let chipLabel: string;
  let chipFill = "";
  let chipInk = "#0b0b0b";
  let chipRule = "#0b0b0b";
  if (parties.length === 0) {
    chipLabel = "bez partii w bazie";
    chipRule = "#c3d4bd";
  } else if (parties.length === 1) {
    const fill = partyColors[parties[0]!] ?? "";
    chipLabel = `partia w bazie: ${parties[0]}`;
    chipFill = fill;
    // The 2px rule in the label's own ink is what stops the pale fills - Polska
    // 2050 at 1.44:1 on this background, PSL 1.83, PO 1.92 - dissolving into
    // the card.
    chipInk = fill ? readableInkOn(fill) : "#0b0b0b";
    chipRule = fill ? chipInk : "#0b0b0b";
  } else {
    chipLabel = truncateDescription(
      `partie w bazie: ${parties.join(", ")}`,
      48,
    );
  }

  // First rung that has anything wins, and they are mutually exclusive: the
  // card makes one claim, the strongest true one.
  let fact = "";
  if (currentPublic.length > 0) {
    const p = [...currentPublic].sort(byDateDesc("start_date"))[0]!;
    const more =
      currentPublic.length > 1 ? ` +${currentPublic.length - 1}` : "";
    fact = `Obecnie: ${postPhrase(p)}${more}`;
  } else if (current.length > 0) {
    // Keeps a mayoralty or a ministry visible: the far end is a region, or a
    // company nobody has confirmed as public sector yet.
    const c = [...current].sort(byDateDesc("start_date"))[0]!;
    const more = current.length > 1 ? ` +${current.length - 1}` : "";
    fact = `Obecnie: ${postPhrase(c)}${more}`;
  } else if (employed.length > 0) {
    const l = [...employed].sort(byDateDesc("end_date"))[0]!;
    const endYear = /^\d{4}/.exec(String(l.end_date ?? ""))?.[0];
    fact = `Ostatnia funkcja: ${postPhrase(l)}${endYear ? `, do ${endYear}` : ""}`;
  } else if (elections.length > 0) {
    const towns = [...new Set(elections.map((e) => e.richNode.name))].slice(
      0,
      3,
    );
    fact = `Starty w wyborach: ${truncateDescription(towns.join(", "), 58)}`;
  }

  // A page with no employment edge has no register provenance behind it, so
  // the footer must not claim any.
  const asOf = baseAsOfLabel(input.now);
  const foot =
    employed.length > 0
      ? `Dane z KRS i źródeł jawnych, stan bazy: ${asOf}.`
      : `Społeczna baza powiązań w instytucjach publicznych. Stan bazy: ${asOf}.`;

  return {
    name: truncateDescription(person.name.trim(), NAME_LIMIT),
    eyebrow: "OSOBA",
    chipLabel,
    chipFill,
    chipInk,
    chipRule,
    nameSize: nameSizeFor(truncateDescription(person.name.trim(), NAME_LIMIT)),
    fact,
    foot,
    // The relation count is deliberately not a cell: `entityDescription`
    // already prints it in the line directly under the image, and a card that
    // repeats its own alt text has spent a band saying nothing new.
    ...statProps([
      {
        value: currentPublic.length,
        label: polishNoun(
          currentPublic.length,
          "obecna posada",
          "obecne posady",
          "obecnych posad",
        ),
      },
      {
        value: publicEmployers,
        label: polishNoun(
          publicEmployers,
          "instytucja publiczna",
          "instytucje publiczne",
          "instytucji publicznych",
        ),
      },
      {
        value: elections.length,
        label: polishNoun(
          elections.length,
          "kandydatura",
          "kandydatury",
          "kandydatur",
        ),
      },
    ]),
  };
}

export function companyCardProps(input: CompanyCardInput): NodeCardProps {
  const { company, sources, owners, subsidiaryCount, location } = input;

  // `edgePerson` is load-bearing, not belt-and-braces: the place node „Rząd”
  // carries outgoing `employed` edges to ministries, so a headcount that only
  // filtered on the edge type would report institutions as board members.
  const board = sources.filter((e) => e.type === "employed" && !!edgePerson(e));
  const currentBoard = board.filter(isCurrent);
  // Sets over person ids, so the 267 known duplicate employment edges do not
  // count anybody twice.
  const currentPeople = new Set(currentBoard.map((e) => e.source));
  const allPeople = new Set(board.map((e) => e.source));

  const organs = new Map<string, Set<string>>();
  for (const e of currentBoard) {
    const organ = displayRole(e.name, company);
    if (!organ) continue;
    const seats = organs.get(organ) ?? new Set<string>();
    seats.add(e.source);
    organs.set(organ, seats);
  }

  // Only a place→place `owns` edge licenses the word „Właściciel”. A
  // region-sourced one is the registered seat, which rung 5 reports as such.
  const ownerPlaces = owners.filter(
    (e) => e.type === "owns" && e.richNode.type === "place",
  );

  // Filled chip = confirmed, outline chip = not confirmed, and that is the
  // whole visual grammar. `isPublic === false` and absent are the SAME state -
  // the model says neither is evidence of private ownership - so both land on
  // „Właściciel nieustalony”. The three labels are copied from
  // `chip/PublicCompany.vue` and may not be reworded independently of it.
  let chipLabel: string;
  let chipFill = "";
  let chipInk = "#4c616b";
  let chipRule = "#c3d4bd";
  if (company.isPublic === true) {
    chipLabel = "Instytucja publiczna";
    chipFill = "#a8c79f";
    chipInk = "#0b0b0b";
    chipRule = "#0b0b0b";
  } else if (publicSectorKnown(company)) {
    chipLabel = "Podmiot prywatny";
  } else {
    chipLabel = "Właściciel nieustalony";
  }

  let fact = "";
  if (organs.size > 0) {
    const parts = [...organs.entries()]
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(
        ([organ, seats]) =>
          `${organ} — ${polishCounting(seats.size, "osoba", "osoby", "osób")}`,
      );
    // „Obecny skład” is the page's own heading, so the card and the page it
    // links to use the same words for the same thing.
    fact = `Obecny skład: ${parts.join(" · ")}`;
  } else if (currentPeople.size > 0) {
    fact = `Obecny skład: ${polishCounting(currentPeople.size, "osoba", "osoby", "osób")}`;
  } else if (allPeople.size > 0) {
    fact = `Dawne władze w bazie: ${polishCounting(allPeople.size, "osoba", "osoby", "osób")}`;
  } else if (ownerPlaces.length > 0) {
    fact = `Właściciel: ${truncateDescription(
      ownerPlaces
        .slice(0, 2)
        .map((e) => e.richNode.name)
        .join(", "),
      58,
    )}`;
  } else if (location) {
    fact = `Siedziba: ${location}`;
  }

  const ids = companyIdentifiers(company)
    .slice(0, 2)
    .map((i) => `${i.register} ${i.value}`);
  // A ministry or an urząd registers with no court, so it has no identifier at
  // all - saying so is honest, and it explains the „Właściciel nieustalony”
  // chip above rather than leaving it to read as evasion.
  const footParts = ids.length ? ids : ["Brak wpisu w KRS"];
  if (location) footParts.push(`siedziba: ${location}`);
  footParts.push(`stan bazy: ${baseAsOfLabel(input.now)}`);

  const eyebrowCategory = asArray(company.categories).filter(Boolean)[0];
  const name = truncateDescription(company.name.trim(), NAME_LIMIT);

  return {
    name,
    eyebrow: eyebrowCategory
      ? categoryTitle(eyebrowCategory).toUpperCase()
      : "INSTYTUCJA",
    chipLabel,
    chipFill,
    chipInk,
    chipRule,
    nameSize: nameSizeFor(name),
    fact,
    foot: truncateDescription(footParts.join(" · "), 96),
    // No individual is ever named on a company card. A private person's name on
    // a permanent, CDN-cached, branded image is a different kind of claim from
    // a row in a list on the page, and a count carries the same information
    // without singling anybody out.
    ...statProps([
      {
        value: currentPeople.size,
        label: polishNoun(
          currentPeople.size,
          "osoba obecnie",
          "osoby obecnie",
          "osób obecnie",
        ),
      },
      {
        value: allPeople.size,
        label: polishNoun(
          allPeople.size,
          "osoba w organach",
          "osoby w organach",
          "osób w organach",
        ),
      },
      {
        // „podmiot” and not „spółka”: an SPZOZ or a wojewódzki fundusz held
        // through an `owns` edge is not a spółka, and calling it one is a
        // category error about a named institution's legal form.
        value: subsidiaryCount,
        label: polishNoun(
          subsidiaryCount,
          "podmiot zależny",
          "podmioty zależne",
          "podmiotów zależnych",
        ),
      },
    ]),
  };
}
