import { computed, ref } from "vue";
import { useCurrentUser } from "vuefire";
import type { Ref } from "vue";
import type {
  HospitalStats,
  HospitalRow,
  RegionRow,
  SupervisoryGroup,
} from "~~/server/api/stats/hospitals.get";
import { supervisoryOrganLabel } from "~~/shared/companyOrgans";
import { partyAliasesOf, partyColors, partyMergedLabels } from "~~/shared/misc";
import { categorical, ink } from "~/utils/chartTheme";
import { generateEntityUrl } from "~/composables/slugs";
import { polishCounting } from "~/composables/polish";

/** Who sits on the supervisory boards of publicly owned hospitals, shaped for
 * /eksploruj/szpitale.
 *
 * The endpoint already did the counting; everything here is presentation. What
 * it does add is the one rule the page is about: the seats it shows by party
 * are the ones on a **rada nadzorcza**, which KSH art. 222(1) § 1 allows a
 * spółka to pay, and never the ones on a **rada społeczna**, which the ustawa o
 * działalności leczniczej pays nothing for. The response keeps the two groups
 * apart so the exclusion can be shown rather than performed quietly - hence
 * `group`, a switch between them, rather than a filter that drops the unpaid
 * half on the way in.
 *
 * Party colours come from `partyColors`, which is the site's canonical set and
 * deliberately small: anything else is stored on a person and has no chip. A
 * party outside it, and the "no party" sentinel, are given a grey and a label
 * here rather than being handed to `PartyChip`, which emits no background at
 * all for a key it does not know.
 */

/** The sentinel /eksploruj/tabela filters on, and what the endpoint returns for
 * a seat whose holder carries no party. Repeated rather than imported: the
 * value lives in `server/utils/hospitalStats`, which the browser bundle cannot
 * reach. */
export const NO_PARTY = "__NONE__";

/** The endpoint's sentinel for a hospital the register places nowhere. Repeated
 * for the same reason as `NO_PARTY`: it lives in `server/utils`, which the
 * browser bundle cannot reach. A row carrying it gets no work-queue link,
 * because `companyTeryt=__NOREGION__` resolves to nothing. */
export const NO_REGION = "__NOREGION__";

/** Which of the response's groups the page is showing. `other` is deliberately
 * not offered: it is the hospitals KRS names no organ for, where there is no
 * evidence either way and so nothing to break down. */
export type BoardGroup = "paid" | "unpaid";

export type PartyDisplay = {
  /** As stored on the person node, or `NO_PARTY`. */
  party: string;
  label: string;
  color: string;
  /** Whether `partyColors` knows it - i.e. whether it may go to `PartyChip`. */
  known: boolean;
};

export type PartyRow = PartyDisplay & {
  seats: number;
  people: number;
  hospitals: number;
  /** Share of the seats that could be attributed to a party at all, or null for
   * the unattributed bucket itself - a share of the group it is the remainder
   * of would be read as a party's result. */
  share: number | null;
  /** The same seats in the explore table. */
  to: string;
};

export type CompositionSpec = {
  key: string;
  label: string;
  value: number;
  color: string;
  labelColor?: string;
};

/** What each group is called on the page.
 *
 * The wording is the careful part. A rada nadzorcza seat is not automatically
 * paid - KSH says a wynagrodzenie "może zostać przyznane" and the uchwała
 * wspólników decides - so it is "co do zasady odpłatna", never "płatna". A rada
 * społeczna member can be reimbursed for wages actually lost by attending
 * (art. 48 ust. 10), so it is "bez wynagrodzenia", never "nic nie dostają".
 */
export const boardGroupLabels: Record<BoardGroup, string> = {
  paid: "Rada nadzorcza — funkcja co do zasady odpłatna",
  unpaid: "Rada społeczna — funkcja pełniona bez wynagrodzenia",
};

/** Short forms, for a toggle that has to fit on a phone. */
export const boardGroupShortLabels: Record<BoardGroup, string> = {
  paid: "Rady nadzorcze",
  unpaid: "Rady społeczne",
};

/** How a party is drawn: its own colour if the site has one for it, a grey and
 * an explicit label otherwise.
 *
 * Two different greys, because "this person has no party in our database" and
 * "this party is not one the site tracks" are different answers and both end up
 * next to each other in the same bar. Neither is `ink.track`: that is the
 * colour of the remainder of a part-to-whole bar, and a slice somebody actually
 * holds must not be drawn as the space nobody holds.
 */
export function partyDisplay(party: string): PartyDisplay {
  if (party === NO_PARTY) {
    return {
      party,
      label: "Bez partii w bazie",
      color: ink.muted,
      known: false,
    };
  }
  const color = partyColors[party];
  return {
    party,
    // A merged key says what it merged - "Nowa Lewica / SLD" rather than a
    // "Nowa Lewica" bar quietly holding both.
    label: partyMergedLabels[party] ?? party,
    color: color ?? ink.axis,
    known: !!color,
  };
}

/** The seats this page counts are the ones held now, so every link out of it
 * says so. Without this the table answered "who has ever sat on a hospital
 * board" - a reader clicking a bar of current seats landed among people whose
 * seat ended years ago, and the queue put a long-gone member ahead of somebody
 * sitting on a board today. `selected` narrows the employer filter beside it -
 * the category, the region, the one hospital - to relations still running. */
const CURRENT_SEATS = { currentlyEmployed: "selected" } as const;

/** A link to the same seats in the explore table: the party, narrowed to the
 * institutions this page counts.
 *
 * Every stored name behind a merged key goes into the query, or the bar and the
 * table it links to would disagree - `party` is an array filter on the table,
 * so "Nowa Lewica / SLD" filters on both. */
function partyTableLink(party: string): string {
  const query = new URLSearchParams();
  for (const alias of partyAliasesOf(party)) query.append("party", alias);
  query.set("category", "szpitale");
  query.set("currentlyEmployed", CURRENT_SEATS.currentlyEmployed);
  return `/eksploruj/tabela?${query.toString()}`;
}

/** The by-party rows of one group, drawable as they stand.
 *
 * Order comes from the endpoint - most seats first, the unattributed bucket
 * always last - and is kept, so a chart drawn straight off this opens with
 * parties.
 *
 * A person with two parties holds one seat and is counted under both, so these
 * sum to more than the group's `seats`. The share is therefore taken against
 * `seatsWithParty`, the seats that carry any party at all, which is the only
 * denominator that cannot exceed 100%.
 */
export function partySeatRows(group: SupervisoryGroup | undefined): PartyRow[] {
  if (!group) return [];
  return group.byParty.map((entry) => ({
    ...partyDisplay(entry.party),
    seats: entry.seats,
    people: entry.people,
    hospitals: entry.hospitals,
    share:
      entry.party === NO_PARTY || group.seatsWithParty === 0
        ? null
        : entry.seats / group.seatsWithParty,
    to: partyTableLink(entry.party),
  }));
}

/** Every publicly owned hospital, split by what supervises it.
 *
 * This is the exclusion, drawn: the blue band is what the breakdown counts,
 * the orange one is what it leaves out and why, and the grey one is the
 * hospitals
 * KRS records no organ for - most of them SPZOZ, whose rada społeczna is
 * created by statute and often never filed, so absence is not evidence of a
 * paid board.
 */
export function supervisionSegments(
  stats: HospitalStats | null | undefined,
): CompositionSpec[] {
  if (!stats) return [];
  return [
    {
      key: "paid",
      label: "Rada nadzorcza",
      value: stats.paid.hospitals,
      color: categorical[0],
    },
    {
      key: "unpaid",
      label: "Rada społeczna (nieuwzględnione)",
      value: stats.unpaid.hospitals,
      color: categorical[1],
    },
    {
      key: "other",
      label: "Bez organu w KRS lub inny organ",
      value: stats.other.hospitals,
      color: ink.track,
      labelColor: ink.secondary,
    },
  ];
}

export type RegionSegment = PartyDisplay & { seats: number };

/** What the one chart on /eksploruj/szpitale is split by.
 *
 * The page used to stack three of these - a party chart, a województwo chart
 * and a hospital table - which asked the reader to hold three scales at once
 * and to notice for themselves that they were three views of the same 591
 * seats. They are one chart with a switch now, and this is the switch. */
export type Breakdown = "party" | "region" | "hospital";

export const breakdownLabels: Record<Breakdown, string> = {
  party: "Partii",
  region: "Województwa",
  hospital: "Szpitala",
};

/** One bar, whatever the chart is split by.
 *
 * `segments` always describes `seats` - the reviewed, published seats - and
 * never `unreviewed`. `unreviewed` is null rather than 0 where the dimension
 * cannot carry a backlog at all, which is exactly one case and an important
 * one: a party. We do not know which party an unreviewed person belongs to and
 * deliberately never will until somebody checks, so a party bar has no tail to
 * draw and the chart says so rather than drawing a zero. */
export type BreakdownRow = {
  key: string;
  label: string;
  /** Shown under or beside the label - the organ, the region, the party's
   * people count. Optional; the party dimension has nothing useful to add. */
  meta?: string;
  seats: number;
  unreviewed: number | null;
  total: number;
  share: number | null;
  segments: RegionSegment[];
  to: string | null;
  /** Where the thing itself lives, when it has a page - a hospital does. */
  href?: string;
};

/** The response as it can actually arrive, which is not the same as the
 * response this build produces.
 *
 * /api/stats/hospitals holds its answer for six hours in two caches - nitro's
 * and Cloud CDN's, and only the first is ours to clear - so for six hours after
 * a deploy that adds a field, readers are served objects built by the previous
 * build. `SupervisoryGroup` describes what the server writes today; these types
 * describe what the browser may be handed, and the difference is exactly the
 * fields this change introduced. Widening here rather than silencing the lint,
 * because the lint is right: at the boundary the value really is optional. */
type CachedRegionRow = Omit<RegionRow, "unreviewed"> &
  Partial<Pick<RegionRow, "unreviewed">>;

/** A hospital row as the browser may receive it. `unreviewed` and `byParty`
 * are the fields the by-hospital split added, so a response from the previous
 * build has neither. */
type CachedHospitalRow = Omit<HospitalRow, "unreviewed" | "byParty"> &
  Partial<Pick<HospitalRow, "unreviewed" | "byParty">>;

export type CachedGroup = Omit<
  SupervisoryGroup,
  "unreviewed" | "byRegion" | "rows"
> & {
  unreviewed?: number;
  byRegion?: CachedRegionRow[];
  rows?: CachedHospitalRow[];
};

export type RegionDisplay = {
  teryt: string;
  /** As the endpoint spells it: "Województwo mazowieckie". */
  name: string;
  /** Just the adjective, for a row label 150px wide. */
  shortName: string;
  hospitals: number;
  groupHospitals: number;
  hospitalsWithSeats: number;
  /** Seats an editor has published - the only thing `segments` describes. */
  seats: number;
  /** People from the register nobody has reviewed. A count; see `RegionRow`. */
  unreviewed: number;
  /** Everything the register puts on these boards, reviewed or not. */
  total: number;
  /** Reviewed over total, or null when there is nothing on record at all. */
  share: number | null;
  /** The party split of `seats`. Never of `unreviewed`. */
  segments: RegionSegment[];
  /** That region's work queue in the explore table, or null when there is no
   * region to filter on. */
  to: string | null;
};

/** The work queue for one województwo.
 *
 * `visibility=private` needs a signed-in reader - /api/nodes answers an
 * anonymous one with an empty table - so the page renders this link disabled
 * until somebody logs in rather than handing them a dead button.
 *
 * `sortBy=latestEmploymentStart` desc is doing double duty. It is the useful
 * order for review, and it also sinks most of the rada społeczna seats this
 * page excludes: their people's `stats.edges.all.latestEmploymentStart` is null
 * for 1,280 of 1,723, and both the Firestore `orderBy` and the in-memory
 * fallback put nulls last under `desc`. It SINKS them, it does not remove them
 * - 443 rada społeczna people do carry a date and stay interleaved - so the
 * button deliberately does not promise a count. The row's own columns carry the
 * numbers instead.
 */
export function regionQueueLink(teryt: string): string | null {
  if (!teryt || teryt === NO_REGION) return null;
  const query = new URLSearchParams({
    category: "szpitale",
    companyTeryt: teryt,
    ...CURRENT_SEATS,
    visibility: "private",
    sortBy: "latestEmploymentStart",
    sortDesc: "true",
  });
  return `/eksploruj/tabela?${query.toString()}`;
}

/** The województwo rows of one group, drawable as they stand.
 *
 * The party segments come from `byParty`, which the endpoint builds from
 * published people only. There is no unreviewed breakdown to map here because
 * the response does not carry one - the count is all there is, and that is the
 * point.
 */
export function regionDisplayRows(
  group: CachedGroup | undefined,
): RegionDisplay[] {
  // Not defensive clutter: see `CachedGroup`. A bare `.map` on a response from
  // the previous build would throw in the browser and take the page with it.
  if (!group?.byRegion) return [];
  return group.byRegion.map((row: CachedRegionRow) => {
    const total = row.seats + (row.unreviewed ?? 0);
    return {
      teryt: row.teryt,
      name: row.name,
      shortName: row.name.replace(/^Województwo\s+/i, ""),
      hospitals: row.hospitals,
      groupHospitals: row.groupHospitals,
      hospitalsWithSeats: row.hospitalsWithSeats,
      seats: row.seats,
      unreviewed: row.unreviewed ?? 0,
      total,
      share: total === 0 ? null : row.seats / total,
      segments: row.byParty.map((entry) => ({
        ...partyDisplay(entry.party),
        seats: entry.seats,
      })),
      to: regionQueueLink(row.teryt),
    };
  });
}

/** The work queue for one hospital: that board, drafts first.
 *
 * A single place id, so /api/nodes can serve it from `array-contains-any`
 * rather than falling back to the in-memory scan it uses past ten ids. */
export function hospitalQueueLink(id: string): string {
  const query = new URLSearchParams({
    place: id,
    ...CURRENT_SEATS,
    visibility: "private",
    sortBy: "latestEmploymentStart",
    sortDesc: "true",
  });
  return `/eksploruj/tabela?${query.toString()}`;
}

/** Every bar of the one chart, whichever way it is split.
 *
 * Three dimensions over one set of seats, so the reader switches the question
 * instead of switching chart - and so the numbers cannot disagree between
 * views, because they are the same numbers read three ways.
 */
export function breakdownRows(
  group: CachedGroup | undefined,
  dimension: Breakdown,
): BreakdownRow[] {
  if (!group) return [];

  if (dimension === "party") {
    return partySeatRows(group as SupervisoryGroup).map((row) => ({
      key: row.party,
      label: row.label,
      meta: `${row.people} os. w ${polishCounting(row.hospitals, "szpitalu", "szpitalach", "szpitalach")}`,
      seats: row.seats,
      // A party has no backlog and must not be given one: nobody has checked
      // which party the unreviewed people belong to. Null, not zero - the chart
      // draws no tail here and says why.
      unreviewed: null,
      total: row.seats,
      share: null,
      segments: [{ ...partyDisplay(row.party), seats: row.seats }],
      to: row.to,
    }));
  }

  if (dimension === "hospital") {
    return (
      (group.rows ?? [])
        // A hospital with neither a reviewed seat nor a backlog says nothing at
        // all. One with only a backlog is the whole point of the page.
        .filter(
          (row: CachedHospitalRow) =>
            row.seats > 0 || (row.unreviewed ?? 0) > 0,
        )
        .map((row: CachedHospitalRow) => {
          const unreviewed = row.unreviewed ?? 0;
          const total = row.seats + unreviewed;
          return {
            key: row.id,
            label: row.name,
            meta: supervisoryOrganLabel(row.supervisoryOrgan),
            seats: row.seats,
            unreviewed,
            total,
            share: total === 0 ? null : row.seats / total,
            segments: (row.byParty ?? []).map((entry) => ({
              ...partyDisplay(entry.party),
              seats: entry.seats,
            })),
            to: hospitalQueueLink(row.id),
            href: generateEntityUrl("place", row.id, row.name),
          };
        })
        .sort(
          (a, b) => b.total - a.total || a.label.localeCompare(b.label, "pl"),
        )
    );
  }

  return regionDisplayRows(group).map((row) => ({
    key: row.teryt,
    label: row.shortName,
    meta: polishCounting(row.groupHospitals, "szpital", "szpitale", "szpitali"),
    seats: row.seats,
    unreviewed: row.unreviewed,
    total: row.total,
    share: row.share,
    segments: row.segments,
    to: row.to,
  }));
}

/** Supervisory boards of publicly owned hospitals, by party.
 *
 * Awaited by the page the way /eksploruj/statystyki awaits its own fetch: the
 * numbers do not depend on who is asking, the endpoint holds them for six
 * hours, and the page is meant to be indexable, so it is server-rendered rather
 * than fetched from the browser.
 */
export async function useHospitalBoards() {
  const user = useCurrentUser();

  // Anonymous readers ask for the plain URL, which is the one the six-hour
  // cache - ours and Cloud CDN's - is holding, and the one that gets indexed.
  // A signed-in reader is the person who might have just published a board
  // member, so they ask for `latest`, which the endpoint answers `no-store`.
  // Reactive rather than read once: vuefire resolves the user after hydration,
  // so at the time of the server render there is nobody to know about yet, and
  // `useFetch` refetches when the query changes.
  const { data, pending, error, refresh } = await useFetch<HospitalStats>(
    "/api/stats/hospitals",
    { query: computed(() => (user.value ? { latest: "true" } : {})) },
  );

  /** Which group the breakdown below is showing. Paid by default: it is the
   * question the page asks. */
  const group: Ref<BoardGroup> = ref("paid");

  /** What the one chart is split by. Party by default, because "which party
   * holds these seats" is the question the page exists to answer; the other two
   * are how a reader checks that answer against a place. */
  const breakdown: Ref<Breakdown> = ref("party");

  const selected = computed<SupervisoryGroup | undefined>(() =>
    data.value ? data.value[group.value] : undefined,
  );

  return {
    /** Resolved here, before the `await` below, and handed back so a page does
     * not call `useCurrentUser()` for itself.
     *
     * A page that awaits this composable has a top-level `await` in its
     * `<script setup>`, and calling a composable AFTER that await runs it with
     * no active effect scope: vuefire registers an `onScopeDispose` and warns,
     * the ref never binds, and the page blanks for a signed-in reader while
     * working perfectly for everyone else. */
    user,
    stats: data,
    pending,
    error,
    refresh,
    group,
    selected,
    partyRows: computed(() => partySeatRows(selected.value)),
    breakdown,
    breakdownRows: computed(() =>
      breakdownRows(selected.value, breakdown.value),
    ),
    segments: computed(() => supervisionSegments(data.value)),
    /** True once the response is in and there is not a single seat to show -
     * which is what the page looks like until the pipeline has re-submitted the
     * hospitals with their supervisory organ. */
    empty: computed(
      () =>
        !!data.value &&
        data.value.paid.seats === 0 &&
        data.value.unpaid.seats === 0,
    ),
  };
}
