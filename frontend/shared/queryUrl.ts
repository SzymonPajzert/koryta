/** What a /eksploruj/tabela query says, as a link and as a Polish sentence.
 *
 * Sharing the table means pasting 168 characters of which `category=szpitale`
 * is the only part that describes the search. The rest is defaults written out
 * in full - `visibility=all` lands in the url as soon as somebody flips a
 * filter there and back - plus `page=3&itemsPerPage=100`, which records where
 * *I* had got to in the results and means nothing to whoever opens the link.
 * `design/tabela-redesign/UDOSTEPNIANIE.md` argues the whole case; this module
 * is its step 1, canonicalisation. The short parameter aliases and the
 * `/q/<hash>` route from that document are not built yet: when they are,
 * `SHARE_KEYS` is the list an alias map hangs off and `shareUrl` the one place
 * that writes a parameter name.
 *
 * The same description also feeds the chip rail in the query bar and the
 * sentence in the share card, so those two and the link cannot drift apart
 * about what is narrowing the table.
 *
 * No Vue and nothing from `app/` on purpose - the server renders og tags from
 * this and the tests import it directly. Region and company names are the one
 * thing only the page can resolve, so they arrive as `lookup`.
 */

import { categoryTitle } from "./companyCategories";
import { longDate } from "./dates";

/** A query value as it reaches us: from `route.query` (string, repeated
 * string, or null), from the api's `Query` type (numbers, already coerced), or
 * from an object a component built by hand. */
export type TableQueryValue =
  string | number | null | undefined | readonly (string | null)[];

/** Every parameter that picks, narrows or orders the table, in the order a
 * shared link spells them out.
 *
 * Past `view`, the list is exactly the filter half of the validator in
 * `server/api/nodes/index.get.ts`. That validator is a plain `z.object`, so it
 * strips any parameter not named there before the query reaches Firestore -
 * which is why dropping an unrecognised key below can only shorten a link, it
 * can never change what the recipient sees.
 *
 * `view` is first because it says what the rest of the link is about - see
 * `tableView`. It never reaches the api: it decides whether the page asks for
 * people at all. `type` is deliberately absent for the same reason: which
 * nodes the table lists is `view`'s to say, and `type=person` in a link would
 * be noise.
 */
const SHARE_KEYS = [
  "view",
  "category",
  "teryt",
  "companyTeryt",
  "party",
  "parties",
  "place",
  "krs",
  "currentlyEmployed",
  "visibility",
  "hideVoted",
  "minEmploymentDate",
  "minVotes",
  "sortBy",
  "sortDesc",
] as const;

export type ShareKey = (typeof SHARE_KEYS)[number];

export type TableQuery = Partial<
  Record<ShareKey | "page" | "itemsPerPage" | "limit", TableQueryValue>
>;

/** The value each filter takes when it is not filtering.
 *
 * `useQueryFilters().choiceFilter` already keeps these out of the url when the
 * page writes them, so they only ever turn up on a link somebody wrote by hand
 * or minted before that composable existed. Dropped rather than trusted:
 * `visibility=all` is not even a value the api's enum accepts.
 *
 * `sortDesc=false` is the direction the table assumes when the parameter is
 * missing, so spelling it out narrows nothing either.
 */
const NEUTRAL: Partial<Record<ShareKey, string>> = {
  currentlyEmployed: "all",
  visibility: "all",
  hideVoted: "all",
  sortDesc: "false",
};

const TABLE_PATH = "/eksploruj/tabela";

/** What the table lists: the people, or the institutions they work in.
 *
 * `people` is the table as it always was and never appears in a url. The
 * companies view answers two reports of the owner's - „W tym widoku brakuje
 * jeszcze spółek” on the rail filter, „Przydałby się teraz po prostu widok i
 * filtr dla spółek” on the sector filter - that the page could say which people
 * work in a sector but not which companies are in it, and so not whether the
 * sector was right.
 */
export const tableViews = ["people", "companies"] as const;

export type TableView = (typeof tableViews)[number];

/** Which list a query asks for. Anything but `companies` - no parameter, or a
 * value from some later version of the site - is the people table, which is
 * what every link minted before the parameter existed meant. */
export function tableView(query: TableQuery): TableView {
  return values(query.view)[0] === "companies" ? "companies" : "people";
}

/** The parameters the companies view reads.
 *
 * A company has a sector, a seat and an identity, so `category`,
 * `companyTeryt` - „Siedziba spółki”, the one control the companies view's
 * panel offers for a region - and the employer pick apply to it. The rest - a
 * person's region (`teryt`, „Region osoby”, any tie a person has to a
 * region), a party, whether a post is still held, and the editors' four
 * verification filters - describe a person and have nothing to say about an
 * institution. They stay in the url, so switching back to
 * people finds them as the reader left them, but they narrow nothing here: the
 * bar greys their chips out, and a shared link leaves them behind.
 */
const COMPANY_VIEW_KEYS: ReadonlySet<ShareKey> = new Set<ShareKey>([
  "view",
  "category",
  "companyTeryt",
  "place",
  "krs",
  "sortBy",
  "sortDesc",
]);

/** Whether a parameter does anything in the given view. */
export function paramAppliesTo(key: ShareKey, view: TableView): boolean {
  return view === "people" || COMPANY_VIEW_KEYS.has(key);
}

/** Whether the query asks the companies view for the order it opens in
 * anyway. The page hands the bar that order spelled out - the view always has
 * one, and the sort button names it - so without this every shared link to it
 * would carry `sortBy=people&sortDesc=true` and every sentence „wg liczby
 * osób”, to ask for what the recipient gets with neither. */
function isDefaultCompanySort(query: TableQuery): boolean {
  // `sortDesc=true` because DEFAULT_COMPANY_SORT runs most-first.
  return (
    tableView(query) === "companies" &&
    values(query.sortBy)[0] === DEFAULT_COMPANY_SORT.key &&
    values(query.sortDesc)[0] === "true"
  );
}

/** Every value a parameter carries, as strings, without the empty ones.
 *
 * A repeated parameter arrives as an array, a single one as a string, and
 * `route.query` writes `null` for `?place` with no `=`. Duplicates are dropped
 * so that `?party=PiS&party=PiS` cannot become a chip reading „Partie: 2”.
 */
function values(value: TableQueryValue): string[] {
  if (value === null || value === undefined || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of list) {
    if (item === null || item === undefined || item === "") continue;
    const text = String(item);
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

/** `polishCounting` from `app/composables/polish.ts`, cut down to picking the
 * noun. Copied rather than imported because that file is an app-layer
 * composable and this module is loaded by the server bundle too; importing it
 * would drag Nuxt's auto-import layer into an api route. */
function counted(n: number, one: string, few: string, many: string): string {
  const tens = Math.abs(n) % 100;
  const units = tens % 10;
  if (tens > 10 && tens < 20) return `${n} ${many}`;
  if (units === 1) return `${n} ${one}`;
  if (units > 1 && units < 5) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** What to call each sort, in a menu and in a sentence.
 *
 * THE KEYS ARE UNTOUCHABLE. Each one is emitted verbatim as `?sortBy=` and
 * handed to a Firestore `orderBy` with no allow-list in between
 * (`server/api/nodes/index.get.ts:145` maps four of them onto stats paths and
 * passes the rest through raw). An unrecognised key does not raise an error -
 * Firestore silently drops every document that lacks the field, so a prettier
 * name here would return an empty table rather than a differently ordered one,
 * and would strand the `?sortBy=` links already in circulation.
 */
export const tableSortOptions = [
  {
    key: "latestEmploymentStart",
    title: "Ostatnie zatrudnienie",
    sentence: "ostatniego zatrudnienia",
  },
  {
    key: "stats.votes.interesting",
    title: "Suma ocen",
    sentence: "sumy ocen",
  },
  { key: "experience", title: "Lata pracy", sentence: "lat pracy" },
  { key: "notesCount", title: "Liczba notatek", sentence: "liczby notatek" },
  {
    key: "factsCount",
    title: "Liczba faktów",
    sentence: "liczby faktów",
  },
  { key: "name", title: "Nazwisko", sentence: "nazwiska" },
  {
    key: "visibility",
    title: "Status",
    sentence: "statusu",
    adminOnly: true,
  },
] as const satisfies readonly {
  key: string;
  title: string;
  sentence: string;
  adminOnly?: boolean;
}[];

/** The orders the companies view offers, as the bar's menu lists them. `short`
 * is what the „Osoby” column's own menu prints beside its title.
 *
 * Not the hazard `tableSortOptions` is: this table is sorted in the browser
 * (`app/utils/companyRows.ts`), and a key it does not know falls back to the
 * default order rather than reaching a Firestore `orderBy`. The keys still go
 * into `?sortBy=` verbatim, so they are not to be renamed once links carry
 * them. What the page must never do is carry one of them into the people view,
 * where `people` would reach that `orderBy` and empty the table - which is why
 * switching views drops the sort.
 */
export const companySortOptions = [
  {
    key: "people",
    title: "Liczba osób",
    sentence: "liczby osób",
    short: "liczba osób",
  },
  {
    key: "current",
    title: "Obecnie zatrudnieni",
    sentence: "liczby obecnie zatrudnionych",
    short: "obecnie zatrudnieni",
  },
  {
    key: "latestStart",
    title: "Najnowsze zatrudnienie",
    sentence: "najnowszego zatrudnienia",
    short: "najnowsze zatrudnienie",
  },
  { key: "name", title: "Nazwa", sentence: "nazwy", short: "nazwa" },
] as const satisfies readonly {
  key: string;
  title: string;
  sentence: string;
  short: string;
}[];

export type CompanySortKey = (typeof companySortOptions)[number]["key"];

/** The order the companies view opens in: the institutions with the most
 * people on the site first. A sector read alphabetically opens on whichever
 * zakład komunalny starts with an A, and the rows a reader came for - the ones
 * with somebody in them - are spread across every page of it. */
export const DEFAULT_COMPANY_SORT = {
  key: "people",
  order: "desc",
} as const satisfies { key: CompanySortKey; order: "asc" | "desc" };

/** The names of a filter's values, resolved by the page.
 *
 * Both are optional because the lists behind them arrive over the network: on
 * the first render, and in a server-rendered og tag, there is no region list
 * to ask. A chip falls back to something true rather than waiting.
 */
export interface QueryLookup {
  region?: (teryt: string) => string | undefined;
  company?: (id: string) => string | undefined;
}

export interface QueryChip {
  /** The parameter this chip stands for, and the filter control to open when
   * its body is clicked. */
  key: ShareKey;
  /** Chip text. Never shortened here: the rail wraps rather than scrolls, so
   * there is room, and a clipped label is a filter the reader cannot check. */
  label: string;
  /** The same filter as a fragment of the sharing sentence, lower case and
   * without its parameter's name. */
  short: string;
  /** Only reachable by an editor, and tinted as such in the bar. */
  admin: boolean;
  /** Every parameter the chip's x has to unset. More than one where two
   * parameters name the same filter, and forgetting the second would leave the
   * table unchanged after a click that promised to widen it. */
  clears: readonly ShareKey[];
  /** Whether the filter narrows the table being shown. False only for a filter
   * about people while the table lists companies - see `paramAppliesTo`. */
  applies: boolean;
}

const EMPLOYMENT_LABELS: Record<string, { label: string; short: string }> = {
  any: { label: "Teraz w publicznej spółce", short: "obecnie zatrudnieni" },
  selected: {
    label: "Teraz w wyszukanych podmiotach",
    short: "w wyszukanych podmiotach",
  },
};

/** One value of a filter offered as a fixed list of them. */
export interface FilterOption {
  value: string;
  /** The entry in the menu, and the chip once the value is chosen. */
  title: string;
  /** The same value as a fragment of the sharing sentence. Absent on the value
   * that means „no filter”: it narrows nothing, so it gets neither a chip nor a
   * word in the sentence. */
  short?: string;
}

/** The two editor-only toggles, in the order their menus list them.
 *
 * Exported because `app/components/form/EksplorujTabelaVerificationFields.vue`
 * builds its selects from these lists. The chip *is* the button that opens
 * that select, so a chip reading „Bez ocenionych” over a menu offering „Brak
 * głosu” would be two names for one filter - and, before this list, was.
 *
 * The values are the api's enum and go into the url verbatim; only the titles
 * are ours to reword.
 */
export const visibilityOptions: FilterOption[] = [
  { value: "all", title: "Wszystkie" },
  { value: "public", title: "Tylko opublikowane", short: "tylko opublikowane" },
  { value: "private", title: "Tylko szkice", short: "tylko szkice" },
];

export const hideVotedOptions: FilterOption[] = [
  { value: "all", title: "Wszystkie" },
  { value: "no_votes", title: "Bez ocenionych", short: "bez ocenionych" },
  { value: "has_votes", title: "Już ocenione", short: "już ocenione" },
];

/** The chip wording for a chosen value, or nothing when the filter is off -
 * which covers both the neutral value and a value the api never had. */
function chosen(
  options: readonly FilterOption[],
  value: string | undefined,
): { label: string; short: string } | undefined {
  const option = options.find((item) => item.value === value);
  if (!option || option.short === undefined) return undefined;
  return { label: option.title, short: option.short };
}

/** The sentinel `availableParties` offers as „Brak partii”. Shown by name, or
 * a chip on that filter would read `__NONE__`. */
const NO_PARTY = "__NONE__";

/** One entry per filter that is narrowing the table, already worded in Polish.
 *
 * Ordered as the rail reads: what we are looking at, then where, then the
 * editor's narrowings. `describeQuery` reorders the same material for a
 * sentence, which reads differently.
 */
export function queryChips(
  query: TableQuery,
  lookup: QueryLookup = {},
): QueryChip[] {
  // Filled in below without `applies`, which depends on the view rather than
  // on the filter and is added to all of them at once on the way out.
  const chips: Omit<QueryChip, "applies">[] = [];

  // `place` holds node ids and `krs` register numbers; both name employers,
  // and a link minted before the switch to node ids carries only the second.
  // One chip for the pair, and its x clears both - dropping only `place` on a
  // legacy link would leave `krs` behind and the table would not move.
  //
  // Counted from `place` alone when it is set, because the page resolves `krs`
  // into node ids and can hand us both spellings of the same employer; adding
  // the two lists would report twice as many institutions as are filtered.
  const places = values(query.place);
  const employers = places.length > 0 ? places : values(query.krs);
  if (employers.length > 0) {
    const only =
      employers.length === 1 ? lookup.company?.(employers[0]!) : undefined;
    chips.push({
      key: "place",
      label:
        employers.length === 1
          ? (only ?? "Wybrana instytucja")
          : `Instytucje: ${employers.length}`,
      short:
        employers.length === 1
          ? (only ?? "wybrana instytucja")
          : counted(employers.length, "instytucja", "instytucje", "instytucji"),
      admin: false,
      clears: ["place", "krs"],
    });
  }

  const teryt = values(query.teryt)[0];
  if (teryt !== undefined) {
    // The raw code rather than a placeholder when the region list has not
    // arrived: „Region: teryt1261” is at least honest about there being a
    // filter, and it is replaced the moment the list resolves.
    const name = lookup.region?.(teryt) ?? teryt;
    chips.push({
      key: "teryt",
      label: `Region: ${name}`,
      short: name,
      admin: false,
      clears: ["teryt"],
    });
  }

  const companyTeryt = values(query.companyTeryt)[0];
  if (companyTeryt !== undefined) {
    const name = lookup.region?.(companyTeryt) ?? companyTeryt;
    chips.push({
      key: "companyTeryt",
      label: `Siedziba: ${name}`,
      short: `siedziba: ${name}`,
      admin: false,
      clears: ["companyTeryt"],
    });
  }

  const category = values(query.category)[0];
  if (category !== undefined) {
    chips.push({
      key: "category",
      label: categoryTitle(category),
      short: categoryTitle(category),
      admin: false,
      clears: ["category"],
    });
  }

  // The url says `party` and the api also accepts `parties`; they are the same
  // filter over the same values, so they are merged and cleared together.
  const parties = values([...values(query.party), ...values(query.parties)]);
  if (parties.length > 0) {
    const only = parties.length === 1 ? parties[0]! : undefined;
    chips.push({
      key: "party",
      label:
        only === undefined
          ? `Partie: ${parties.length}`
          : only === NO_PARTY
            ? "Brak partii"
            : only,
      short:
        only === undefined
          ? counted(parties.length, "partia", "partie", "partii")
          : only === NO_PARTY
            ? "bez partii"
            : only,
      admin: false,
      clears: ["party", "parties"],
    });
  }

  const employment = values(query.currentlyEmployed)[0];
  const employmentLabels = employment
    ? EMPLOYMENT_LABELS[employment]
    : undefined;
  if (employmentLabels) {
    chips.push({
      key: "currentlyEmployed",
      ...employmentLabels,
      admin: false,
      clears: ["currentlyEmployed"],
    });
  }

  const visibilityLabels = chosen(
    visibilityOptions,
    values(query.visibility)[0],
  );
  if (visibilityLabels) {
    chips.push({
      key: "visibility",
      ...visibilityLabels,
      admin: true,
      clears: ["visibility"],
    });
  }

  const votedLabels = chosen(hideVotedOptions, values(query.hideVoted)[0]);
  if (votedLabels) {
    chips.push({
      key: "hideVoted",
      ...votedLabels,
      admin: true,
      clears: ["hideVoted"],
    });
  }

  const minEmploymentDate = values(query.minEmploymentDate)[0];
  if (minEmploymentDate !== undefined) {
    // Written out in Polish, because this string is read as prose: on the rail
    // it stands beside „Tylko szkice” and in the share card inside a sentence,
    // where „od 2024-01-15” is the one machine-shaped thing on the page.
    //
    // The url is the only source for it and anybody can type into a url, so
    // the fallback prints whatever arrived rather than `longDate`'s „brak
    // daty”: a chip that has to be cleared must say which filter it is, and
    // the reader who typed the value is the only one who can recognise it.
    const spelled = longDate(minEmploymentDate, "") || minEmploymentDate;
    chips.push({
      key: "minEmploymentDate",
      label: `Zatrudnieni od ${spelled}`,
      short: `od ${spelled}`,
      admin: true,
      clears: ["minEmploymentDate"],
    });
  }

  // Zero is a filter, not an absent one: the api turns `minVotes` into a
  // Firestore `>=`, and a range filter excludes every document that has no
  // `stats.votes.interesting` field at all. Hiding the chip for `minVotes=0`
  // would leave those people missing from the table with nothing on screen to
  // explain it.
  const minVotes = values(query.minVotes)[0];
  if (minVotes !== undefined) {
    const parsed = Number.parseInt(minVotes, 10);
    const phrase = Number.isNaN(parsed)
      ? `${minVotes} głosów`
      : counted(parsed, "głos", "głosy", "głosów");
    chips.push({
      key: "minVotes",
      label: `Min. ${phrase}`,
      short: `min. ${phrase}`,
      admin: true,
      clears: ["minVotes"],
    });
  }

  const view = tableView(query);
  return chips.map((chip) => ({
    ...chip,
    applies: paramAppliesTo(chip.key, view),
  }));
}

/** A sentence reads in a different order than the rail: what we are looking
 * for first, then where, then how it was narrowed down. */
const SENTENCE_ORDER: readonly ShareKey[] = [
  "category",
  "place",
  "teryt",
  "companyTeryt",
  "party",
  "currentlyEmployed",
  "visibility",
  "hideVoted",
  "minEmploymentDate",
  "minVotes",
];

/** The query as one line of Polish: „Szpitale · Kraków · tylko szkice · wg
 * sumy ocen”.
 *
 * A link is not frightening because it is long, it is frightening because it
 * says nothing: whoever receives `visibility=private` has no way to know they
 * are being sent a list of drafts. This sentence goes next to the address in
 * the share card, is copied with it, and belongs in the page's `og:title` -
 * today every query on /eksploruj/tabela shares one title.
 *
 * Admin filters are described like any other. The sentence has to match the
 * link, and the link carries them.
 *
 * A link to the companies view opens on the word „spółki”, since everything
 * after it reads the same either way - „Koleje · Kraków” is a sector and a
 * place whichever of the two lists they narrow. The filters that narrow
 * nothing there are left out, as the link leaves them out.
 */
export function describeQuery(
  query: TableQuery,
  lookup: QueryLookup = {},
): string {
  const view = tableView(query);
  const byKey = new Map(
    queryChips(query, lookup)
      .filter((chip) => chip.applies)
      .map((chip) => [chip.key, chip.short]),
  );

  const words: string[] = [];
  for (const key of SENTENCE_ORDER) {
    const word = byKey.get(key);
    if (word !== undefined) words.push(word);
  }

  const sortBy = values(query.sortBy)[0];
  const sort = (
    view === "companies" ? companySortOptions : tableSortOptions
  ).find((option) => option.key === sortBy);
  // An unknown sort key is left out rather than printed: it is either a link
  // from a future version of the site or a typo, and neither has a Polish name
  // to offer. So is the companies view's own default, which the link leaves
  // out too.
  if (sort && !isDefaultCompanySort(query)) words.push(`wg ${sort.sentence}`);

  if (view === "companies") {
    return words.length > 0
      ? ["spółki", ...words].join(" · ")
      : "wszystkie spółki w bazie";
  }
  return words.length > 0 ? words.join(" · ") : "wszystkie osoby w bazie";
}

/** The query stripped down to what is worth sharing.
 *
 * Drops paging, drops every filter sitting at its neutral value, and keeps the
 * keys in `SHARE_KEYS` order so that the same search always produces the same
 * object - and, through `shareUrl`, the same string. That last part is what a
 * `/q/<hash>` route would need later: a hash of a query whose keys can arrive
 * in any order would mint a new document per visitor.
 */
export function shareQuery(
  query: TableQuery,
): Record<string, string | string[]> {
  const shared: Record<string, string | string[]> = {};
  const view = tableView(query);
  const defaultSort = isDefaultCompanySort(query);

  for (const key of SHARE_KEYS) {
    if (defaultSort && (key === "sortBy" || key === "sortDesc")) continue;
    // A party or a „Tylko szkice” left over from the people view narrows
    // nothing in the companies one, so it is not part of what is being shared.
    if (!paramAppliesTo(key, view)) continue;
    // Written as it was read: a value `tableView` does not recognise opens the
    // people table, which is what a link without the parameter does too.
    if (key === "view") {
      if (view !== "people") shared.view = view;
      continue;
    }

    // A direction with nothing to sort by. The table only reads `sortDesc`
    // when `sortBy` is set, so on its own it is a parameter that describes
    // nothing.
    if (key === "sortDesc" && values(query.sortBy).length === 0) continue;

    const kept = values(query[key]).filter((value) => value !== NEUTRAL[key]);
    if (kept.length === 0) continue;
    shared[key] = kept.length === 1 ? kept[0]! : kept;
  }

  return shared;
}

/** The canonical address for a query.
 *
 * `origin` is passed in rather than read from `window`, so the server can
 * build the same string for an og tag; pass `""` for a relative link.
 *
 * `withPaging` re-adds the page and the row count for the reader who really
 * did mean „look at this row, on this page”. Off by default, because the
 * recipient of a link to page 3 of a search they have never run has no idea
 * what they are looking at, and the first page is where they should start.
 */
export function shareUrl(
  query: TableQuery,
  origin = "",
  options: { withPaging?: boolean } = {},
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(shareQuery(query))) {
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item);
    }
  }

  if (options.withPaging) {
    const perPage = values(query.itemsPerPage ?? query.limit)[0];
    const page = values(query.page)[0];
    if (perPage !== undefined) params.append("itemsPerPage", perPage);
    // Page 1 is where a link without a page lands anyway.
    if (page !== undefined && page !== "1") params.append("page", page);
  }

  const search = params.toString();
  return `${origin.replace(/\/$/, "")}${TABLE_PATH}${search ? `?${search}` : ""}`;
}
