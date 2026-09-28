/** Who sits on the supervisory boards of publicly owned hospitals, by party.
 *
 * The pure half of /api/stats/hospitals: everything here takes rows and returns
 * rows, so the rules can be tested without a Firestore. The handler does the
 * reading.
 *
 * THE DISTINCTION THIS EXISTS FOR. A hospital run as a spółka has a rada
 * nadzorcza, whose members may be paid - KSH art. 222(1) § 1 says a
 * wynagrodzenie "może zostać przyznane", the uchwała wspólników sets it, and
 * the ustawa z 9 czerwca 2016 r. caps it. A hospital run as a samodzielny
 * publiczny zakład opieki zdrowotnej has a rada społeczna instead, and the
 * ustawa o działalności leczniczej gives its members neither wynagrodzenie nor
 * dieta - art. 48 ust. 9-10 allow only a reimbursement of wages a member
 * actually lost by attending, and only when their employer gave them unpaid
 * leave for it. Counting the two together would report a few thousand unpaid
 * seats as paid ones.
 *
 * The register is the only thing that can tell them apart, and rejestr.io -
 * where the edges come from - cannot: it labels every supervisory connection
 * KRS_SUPERVISION, which the scrapers map to the literal role "Rada Nadzorcza",
 * rada społeczna members included. So the edge says *that* somebody supervises
 * and the company's `supervisoryOrgan` says *what they sit on*. Both are needed.
 *
 * `supervisoryOrgan`, not `supervisoryBody`. The two are different readings of
 * the register and only this one is fine enough for a page that reports boards:
 * `supervisoryBody` comes from the legal form and answers a yes/no about pay,
 * which is what the employment counters need, while this comes from
 * `dzial2.organNadzoru` and can name a komisja rewizyjna or say the entry filed
 * nothing. See `shared/companyOrgans.ts`.
 *
 * WHY THE RULE IS AN ALLOWLIST. Most SPZOZ file no organ with KRS at all - the
 * rada społeczna is created by statute, not by the entry - so "everything
 * except a rada społeczna" would quietly readmit hundreds of unpaid boards.
 * Only `supervisoryOrgan === "rada_nadzorcza"` counts as paid; everything else,
 * absent included, is reported separately and left out of the breakdown.
 *
 * Seats, not money. Nothing in the database holds a remuneration: the 2016 act
 * sets a ceiling and the actual figure lives in each spółka's uchwała. What can
 * be counted is who holds a seat that is paid at all.
 */

import { asArray, pageIsPublic } from "~~/shared/model";
import { canonicalParty, OTHER_PARTY } from "~~/shared/misc";
import {
  supervisoryOrgans,
  type SupervisoryOrgan,
} from "~~/shared/companyOrgans";
import { wojewodztwoLabel, wojewodztwoOf } from "~~/shared/teryt";

/** A place node, as much of it as this endpoint reads.
 *
 * `region` is not on the node. A company's seat is an edge from the region that
 * holds it, so the handler resolves it and hands it in here - which keeps this
 * half of the endpoint a pure function of rows, the way the rest of it is. */
export type HospitalPlaceRow = {
  id: string;
  name?: string;
  categories?: string[] | Record<string, string>;
  legalForm?: string;
  supervisoryOrgan?: string;
  isPublic?: boolean;
  published?: unknown;
  deleted?: unknown;
  /** TERYT of the region this hospital is seated in, at whatever depth the
   * register gave - a gmina, a powiat, or a województwo. Rolled up to the
   * two-digit województwo here. */
  regionTeryt?: string;
};

/** An `employed` edge: `source` is the person, `target` the institution, and
 * `name` the role, which is where the person ingest puts it. */
export type BoardEdgeRow = {
  source?: string;
  target?: string;
  name?: string;
  end_date?: string;
  published?: unknown;
  deleted?: unknown;
};

/** A person node, as much of it as this endpoint reads. */
export type BoardPersonRow = {
  id: string;
  name?: string;
  parties?: string[] | Record<string, string>;
  published?: unknown;
  deleted?: unknown;
};

/** The sentinel the rest of the site already uses for "no party", so a link
 * built out of this response lands on the filter the table understands - see
 * `applyPartiesFilter` in server/utils/fetch.ts. */
export const NO_PARTY = "__NONE__";

/** What a breakdown sorts parties on first, ahead of their seats: the parties
 * the site names, then „Inne”, then the sentinel. The last two are the
 * breakdown's greys - a tie to some party, and none on record - so a chart
 * drawn straight off the list opens with the parties it names and ends with
 * its greys side by side, whatever their sizes. */
const partyTail = (party: string) =>
  party === NO_PARTY ? 2 : party === OTHER_PARTY ? 1 : 0;

/** Where a hospital goes when the register does not place it in any region.
 *
 * Not two digits, deliberately: `/eksploruj/tabela?companyTeryt=` would take
 * this value and answer with an empty table, so the composable can tell the
 * difference and omit the link rather than offering a dead one. Production has
 * no such hospital today - all 482 resolve - but a newly ingested one has no
 * seat edge until the region pass runs, and it must not vanish from a page
 * whose whole point is what is missing. */
export const NO_REGION = "__NOREGION__";

export type PartySeats = {
  /** A party as it is stored on the person node, or `NO_PARTY`. */
  party: string;
  /** Seats held by somebody carrying this party. A person with two parties is
   * counted under both, so these sum to more than the group's `seats`;
   * `seatsWithParty` is the honest denominator for a share. */
  seats: number;
  people: number;
  hospitals: number;
};

export type HospitalRow = {
  id: string;
  name: string;
  /** Null when the scrapers have not looked at this company since the field was
   * added, as opposed to `"brak"`, which means KRS names no organ. */
  supervisoryOrgan: SupervisoryOrgan | null;
  legalForm: string | null;
  seats: number;
  /** People the register seats on this board whom nobody has reviewed. A count,
   * for the same reason `SupervisoryGroup.unreviewed` is - and the reason a
   * hospital with no reviewed seat is still worth a row: it is the work. */
  unreviewed: number;
  /** Parties seated on this board, most seats first. Describes `seats` only. */
  parties: string[];
  /** Seats by party, so one chart can break a hospital down the way it breaks a
   * województwo down. `parties` is this list's keys, kept for callers that only
   * want the chips. */
  byParty: PartySeats[];
};

/** One województwo's share of a group, as /eksploruj/szpitale draws it.
 *
 * THE RULE THIS TYPE ENFORCES. `byParty` describes `seats` and only `seats` -
 * the seats an editor has published. `unreviewed` is a bare count and carries
 * no breakdown of any kind, because the party on an unreviewed person comes
 * from a name match nobody approved. There is deliberately no `unreviewedByParty`
 * here: the numbers do not exist on this object, so no view built on it can
 * leak them, however it is drawn.
 */
export type RegionRow = {
  /** Two digits. The województwo is the coarsest TERYT level and the only one
   * the register fills in for every hospital. */
  teryt: string;
  name: string;
  /** Publicly owned hospitals seated here, whatever supervises them. */
  hospitals: number;
  /** ...of which are supervised by the organ this group counts. */
  groupHospitals: number;
  /** ...of which have at least one published seat. */
  hospitalsWithSeats: number;
  /** Seats an editor has published. What `byParty` breaks down. */
  seats: number;
  /** People the register puts on these boards whom nobody has reviewed.
   * A COUNT, and nothing else - see the note on this type. */
  unreviewed: number;
  /** Of `seats`, those held by somebody with a party on their published node. */
  seatsWithParty: number;
  /** Party breakdown of `seats`. Never of `unreviewed`. */
  byParty: PartySeats[];
};

export type SupervisoryGroup = {
  /** The organ kinds counted here, so the page can name what it shows without
   * hardcoding the split a second time. */
  kinds: SupervisoryOrgan[];
  hospitals: number;
  /** Hospitals in this group with at least one seat on record. The rest are the
   * denominator that stops a party looking clean when it is only unobserved. */
  hospitalsWithSeats: number;
  /** Seats currently held. One person on one board is one seat, however many
   * spells the database records for them. */
  seats: number;
  /** Seats the database says somebody has left. Reported rather than counted:
   * an odpis aktualny only ever names the sitting board. */
  endedSeats: number;
  /** Of `seats`, those held by somebody with a party on their node. */
  seatsWithParty: number;
  /** People the register puts on these boards whom nobody has reviewed - the
   * seats that exist in the database but are not visible on the site.
   *
   * A COUNT. It is never broken down, here or anywhere downstream: the party
   * stored against an unreviewed person is an unapproved name match, and
   * publishing a party breakdown of it would state as fact the very thing an
   * editor has not yet checked. `buildHospitalStats` reads `parties` only from
   * people passing `pageIsPublic`, so those attributions never leave the
   * server, and this field is the only thing said about them.
   */
  unreviewed: number;
  byParty: PartySeats[];
  rows: HospitalRow[];
  /** The same group split by województwo, most seats known first. */
  byRegion: RegionRow[];
};

export type HospitalStats = {
  /** When the numbers were computed, so a cached page can say how fresh it is. */
  generatedAt: string;
  /** Every publicly owned hospital in the database, whatever supervises it. */
  hospitals: number;
  /** Boards whose seats are, as a rule, paid. This is the breakdown the page is
   * about. */
  paid: SupervisoryGroup;
  /** Boards whose seats are not paid. Counted and returned so that the
   * exclusion can be shown rather than silently applied. */
  unpaid: SupervisoryGroup;
  /** Everything else: a hospital KRS records no supervisory organ for, one the
   * scrapers have not read since the field was added, and the few whose organ
   * is neither. Out of both breakdowns because there is no evidence either
   * way. */
  other: SupervisoryGroup;
};

const PAID_KINDS: SupervisoryOrgan[] = ["rada_nadzorcza"];
const UNPAID_KINDS: SupervisoryOrgan[] = ["rada_spoleczna"];
const OTHER_KINDS: SupervisoryOrgan[] = supervisoryOrgans.filter(
  (kind) => !PAID_KINDS.includes(kind) && !UNPAID_KINDS.includes(kind),
);

/** Whether a place is a hospital this page counts.
 *
 * `isPublic === true` rather than `publicSectorKnown`: only `true` asserts
 * public ownership, and this page is a claim about public money. It costs
 * coverage - KRS does not publish the shareholders of a spółka akcyjna unless
 * there is exactly one, so some genuinely samorządowe hospitals read as unknown
 * and are missing here. That is the right way round for a page that names
 * people.
 */
export function isPublicHospital(place: HospitalPlaceRow): boolean {
  if (!pageIsPublic(place)) return false;
  if (place.isPublic !== true) return false;
  return asArray<string>(place.categories).includes("szpitale");
}

/** Whether an employment role is a seat on a supervisory board.
 *
 * The roles the KRS pipeline writes are "Zarząd", "Rada Nadzorcza", "Prokurent"
 * and "Pełnomocnik"; a human filling in the relation form can type anything.
 * Matched on the front of the string, with case and spacing folded, so that
 * "Rada Nadzorcza (przewodniczący)" and a stray double space both count.
 *
 * "Rada Społeczna" is accepted against the day the scrapers start labelling
 * those correctly. Today they do not, which is precisely why the paid/unpaid
 * split is decided by the company's `supervisoryOrgan` and not here.
 */
export function isSupervisoryRole(role: string | undefined): boolean {
  if (!role) return false;
  const folded = role.toUpperCase().replace(/\s+/g, " ").trim();
  return (
    folded.startsWith("RADA NADZORCZA") ||
    folded.startsWith("RADA SPOŁECZNA") ||
    folded.startsWith("RADA SPOLECZNA")
  );
}

function supervisoryOrganOf(place: HospitalPlaceRow): SupervisoryOrgan | null {
  const value = place.supervisoryOrgan as SupervisoryOrgan | undefined;
  return value && supervisoryOrgans.includes(value) ? value : null;
}

type Seat = { placeId: string; personId: string };

/** The board seats an edge set describes, deduplicated.
 *
 * One person on one board is one seat: the database can hold two `employed`
 * edges for the same person and hospital - a spell recorded twice, or a
 * re-appointment after a break - and counting both would inflate a board past
 * its own size. An ended spell is returned separately rather than counted: an
 * odpis aktualny only names the sitting board, so somebody with an end date has
 * left. If they also hold an open spell, the open one wins.
 *
 * `unreviewed` is the third bucket and the one /eksploruj/szpitale is mostly
 * made of: a sitting seat the register asserts and no editor has published.
 * It is deliberately a list of the same `Seat` shape rather than a number, so
 * that the caller can attribute it to a hospital and a region - but nothing
 * downstream ever reads a party off it, because the person behind it has not
 * been checked. A pair holding both a draft and a published open spell counts
 * as reviewed, not as backlog.
 */
export function boardSeats(
  edges: BoardEdgeRow[],
  today: string,
): { current: Seat[]; ended: Seat[]; unreviewed: Seat[] } {
  const current = new Map<string, Seat>();
  const ended = new Map<string, Seat>();
  const unreviewed = new Map<string, Seat>();

  for (const edge of edges) {
    if (!edge.source || !edge.target) continue;
    if (!isSupervisoryRole(edge.name)) continue;
    // An approved removal is not backlog - there is nothing left to review.
    if (edge.deleted === true) continue;

    const key = `${edge.target}|${edge.source}`;
    const seat = { placeId: edge.target, personId: edge.source };
    const over = !!edge.end_date && edge.end_date < today;

    if (!pageIsPublic(edge)) {
      // A spell the register says is over is not work waiting to be done.
      if (!over) unreviewed.set(key, seat);
      continue;
    }
    if (over) ended.set(key, seat);
    else current.set(key, seat);
  }

  for (const key of current.keys()) {
    ended.delete(key);
    unreviewed.delete(key);
  }

  return {
    current: [...current.values()],
    ended: [...ended.values()],
    unreviewed: [...unreviewed.values()],
  };
}

/** What to call a województwo row.
 *
 * The region nodes spell the sixteen inconsistently - some carry the
 * "Województwo" prefix and some are the bare adjective - so the name goes
 * through the same normaliser the explore filters use. A code with no node
 * behind it keeps its digits: a row that cannot be named is still a real
 * backlog, and dropping it would quietly shrink the totals. */
function regionName(
  teryt: string,
  names: Record<string, string> | undefined,
): string {
  if (teryt === NO_REGION) return "Bez regionu w bazie";
  const name = names?.[teryt];
  return name ? wojewodztwoLabel(name) : `Województwo ${teryt}`;
}

function emptyGroup(kinds: SupervisoryOrgan[]): SupervisoryGroup {
  return {
    kinds,
    hospitals: 0,
    hospitalsWithSeats: 0,
    seats: 0,
    endedSeats: 0,
    seatsWithParty: 0,
    unreviewed: 0,
    byParty: [],
    rows: [],
    byRegion: [],
  };
}

/** A party tally while it is being built. Sets rather than counters because a
 * person can hold three seats and the same party can reach one hospital through
 * several of them. */
type Tally = { seats: number; people: Set<string>; hospitals: Set<string> };

/** The whole response, from the three collections it takes to build it.
 *
 * `today` is passed in rather than read off the clock, so that a test can say
 * which spells are over.
 */
export function buildHospitalStats(input: {
  places: HospitalPlaceRow[];
  edges: BoardEdgeRow[];
  people: BoardPersonRow[];
  generatedAt: string;
  today: string;
  /** Województwo name by two-digit TERYT. The handler reads the sixteen region
   * nodes; a code missing from here falls back to its own digits rather than
   * dropping the row, because a nameless region is still a real backlog. */
  wojewodztwoNames?: Record<string, string>;
}): HospitalStats {
  const hospitals = input.places.filter(isPublicHospital);
  const byId = new Map(hospitals.map((place) => [place.id, place]));

  // Only people who have a page of their own are attributed. An unpublished
  // person node is a draft nobody has checked; the seat still counts, it just
  // lands under "no party" rather than under a party read off a draft.
  const parties = new Map<string, string[]>();
  for (const person of input.people) {
    if (!pageIsPublic(person)) continue;
    // A Set, and canonicalised before it: somebody whose node carries both
    // "SLD" and "Nowa Lewica" holds ONE seat and must add one to the merged
    // key, not two. See `partyAliases`.
    parties.set(person.id, [
      ...new Set(
        asArray<string>(person.parties)
          .filter((party) => !!party)
          .map(canonicalParty),
      ),
    ]);
  }

  const groups = {
    paid: emptyGroup(PAID_KINDS),
    unpaid: emptyGroup(UNPAID_KINDS),
    other: emptyGroup(OTHER_KINDS),
  };
  const groupOf = (placeId: string): SupervisoryGroup | undefined => {
    const place = byId.get(placeId);
    if (!place) return undefined;
    const kind = supervisoryOrganOf(place);
    if (kind && PAID_KINDS.includes(kind)) return groups.paid;
    if (kind && UNPAID_KINDS.includes(kind)) return groups.unpaid;
    return groups.other;
  };

  const tallies = new Map<SupervisoryGroup, Map<string, Tally>>([
    [groups.paid, new Map()],
    [groups.unpaid, new Map()],
    [groups.other, new Map()],
  ]);
  const rows = new Map<string, HospitalRow>();
  const rowParties = new Map<string, Map<string, number>>();

  // --- by województwo ------------------------------------------------------
  // Filled from the same loops as the group counters below rather than derived
  // afterwards, so a region row cannot drift from the total it belongs to.
  type RegionAcc = {
    teryt: string;
    groupHospitals: number;
    hospitalsWithSeats: number;
    seats: number;
    unreviewed: number;
    seatsWithParty: number;
    parties: Map<string, Tally>;
  };
  const regionAcc = new Map<SupervisoryGroup, Map<string, RegionAcc>>([
    [groups.paid, new Map()],
    [groups.unpaid, new Map()],
    [groups.other, new Map()],
  ]);
  /** Public hospitals per województwo, whatever supervises them - the same for
   * all three groups, so counted once. */
  const hospitalsPerWoj = new Map<string, number>();
  const wojOf = (placeId: string): string =>
    wojewodztwoOf(byId.get(placeId)?.regionTeryt ?? "") ?? NO_REGION;
  const regionOf = (group: SupervisoryGroup, placeId: string): RegionAcc => {
    const woj = wojOf(placeId);
    const perGroup = regionAcc.get(group)!;
    let acc = perGroup.get(woj);
    if (!acc) {
      acc = {
        teryt: woj,
        groupHospitals: 0,
        hospitalsWithSeats: 0,
        seats: 0,
        unreviewed: 0,
        seatsWithParty: 0,
        parties: new Map(),
      };
      perGroup.set(woj, acc);
    }
    return acc;
  };

  for (const place of hospitals) {
    const group = groupOf(place.id)!;
    group.hospitals++;
    const woj = wojOf(place.id);
    hospitalsPerWoj.set(woj, (hospitalsPerWoj.get(woj) ?? 0) + 1);
    regionOf(group, place.id).groupHospitals++;
    rows.set(place.id, {
      id: place.id,
      name: place.name ?? place.id,
      supervisoryOrgan: supervisoryOrganOf(place),
      legalForm: place.legalForm ?? null,
      seats: 0,
      unreviewed: 0,
      parties: [],
      byParty: [],
    });
    rowParties.set(place.id, new Map());
  }

  const { current, ended, unreviewed } = boardSeats(
    input.edges.filter((edge) => !!edge.target && byId.has(edge.target)),
    input.today,
  );

  for (const seat of current) {
    const group = groupOf(seat.placeId)!;
    const row = rows.get(seat.placeId)!;
    const tally = tallies.get(group)!;

    group.seats++;
    row.seats++;

    // A person with no party still holds the seat, so it is counted under the
    // sentinel rather than dropped: a breakdown showing only the seats it could
    // attribute would overstate every party's share of the board.
    const region = regionOf(group, seat.placeId);
    region.seats++;

    const held = parties.get(seat.personId) ?? [];
    if (held.length > 0) {
      group.seatsWithParty++;
      region.seatsWithParty++;
    }
    for (const party of held.length > 0 ? held : [NO_PARTY]) {
      const entry = tally.get(party) ?? {
        seats: 0,
        people: new Set<string>(),
        hospitals: new Set<string>(),
      };
      entry.seats++;
      entry.people.add(seat.personId);
      entry.hospitals.add(seat.placeId);
      tally.set(party, entry);

      const perRegion = region.parties.get(party) ?? {
        seats: 0,
        people: new Set<string>(),
        hospitals: new Set<string>(),
      };
      perRegion.seats++;
      perRegion.people.add(seat.personId);
      perRegion.hospitals.add(seat.placeId);
      region.parties.set(party, perRegion);

      const perRow = rowParties.get(seat.placeId)!;
      perRow.set(party, (perRow.get(party) ?? 0) + 1);
    }
  }

  for (const seat of ended) groupOf(seat.placeId)!.endedSeats++;
  // Counted, never attributed. `parties` is not consulted here and must not be:
  // the person behind an unreviewed seat is a draft, and their stored party is
  // an unapproved match.
  for (const seat of unreviewed) {
    const group = groupOf(seat.placeId)!;
    group.unreviewed++;
    regionOf(group, seat.placeId).unreviewed++;
    rows.get(seat.placeId)!.unreviewed++;
  }

  for (const [group, tally] of tallies) {
    group.byParty = [...tally.entries()]
      .map(([party, entry]) => ({
        party,
        seats: entry.seats,
        people: entry.people.size,
        hospitals: entry.hospitals.size,
      }))
      // The sentinel sorts last whatever its size, so that a chart drawn
      // straight off this list opens with parties rather than with the bucket
      // for everyone we could not place - and „Inne” just before it.
      .sort(
        (a, b) =>
          partyTail(a.party) - partyTail(b.party) ||
          b.seats - a.seats ||
          a.party.localeCompare(b.party),
      );
  }

  for (const place of hospitals) {
    const group = groupOf(place.id)!;
    const row = rows.get(place.id)!;
    if (row.seats > 0) {
      group.hospitalsWithSeats++;
      regionOf(group, place.id).hospitalsWithSeats++;
    }
    const ordered = [...rowParties.get(place.id)!.entries()].sort(
      (a, b) =>
        partyTail(a[0]) - partyTail(b[0]) ||
        b[1] - a[1] ||
        a[0].localeCompare(b[0]),
    );
    row.parties = ordered.map(([party]) => party);
    // `people` and `hospitals` are 1 by construction here: this is one board, so
    // a party's seats on it are held by that many people at this one hospital.
    row.byParty = ordered.map(([party, seats]) => ({
      party,
      seats,
      people: seats,
      hospitals: 1,
    }));
    group.rows.push(row);
  }

  for (const group of Object.values(groups)) {
    group.rows.sort(
      (a, b) => b.seats - a.seats || a.name.localeCompare(b.name),
    );
  }

  for (const [group, perGroup] of regionAcc) {
    group.byRegion = [...perGroup.values()]
      .map((acc) => ({
        teryt: acc.teryt,
        name: regionName(acc.teryt, input.wojewodztwoNames),
        hospitals: hospitalsPerWoj.get(acc.teryt) ?? 0,
        groupHospitals: acc.groupHospitals,
        hospitalsWithSeats: acc.hospitalsWithSeats,
        seats: acc.seats,
        unreviewed: acc.unreviewed,
        seatsWithParty: acc.seatsWithParty,
        byParty: [...acc.parties.entries()]
          .map(([party, entry]) => ({
            party,
            seats: entry.seats,
            people: entry.people.size,
            hospitals: entry.hospitals.size,
          }))
          .sort(
            (a, b) =>
              partyTail(a.party) - partyTail(b.party) ||
              b.seats - a.seats ||
              a.party.localeCompare(b.party),
          ),
      }))
      // Everything known first, biggest backlog at the top of it - the page
      // sorts for itself, but an unsorted list would make the default arbitrary.
      .sort(
        (a, b) =>
          Number(a.teryt === NO_REGION) - Number(b.teryt === NO_REGION) ||
          b.seats + b.unreviewed - (a.seats + a.unreviewed) ||
          a.name.localeCompare(b.name, "pl"),
      );
  }

  return {
    generatedAt: input.generatedAt,
    hospitals: hospitals.length,
    ...groups,
  };
}
