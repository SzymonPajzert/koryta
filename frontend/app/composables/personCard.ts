/** What goes on the picture a platform draws for a person's page, laid out as
 * that page is (decision on 2026-11-28): the name with its party chips, then
 * rows of „Historia powiązań” - each post's institution, its role, the
 * public-institution and sector chips, and a bar of when it was held.
 *
 * The rows say what the page's rows say: the role through `displayRole`, the
 * dates through `relationPeriodLabel`. Two things differ, both decided on
 * 2026-11-28. Public institutions come first, newest first among them, where
 * the page simply lists the newest first. And the bars share one axis that
 * runs from the earliest of the rows on the card to today, where the page's
 * covers every relation the person has - on the card the hidden ones would
 * only push the shown bars into a corner.
 *
 * Only relations to an institution or a place are drawn: a row naming another
 * person stays on the page, for the reason the company card names nobody.
 *
 * Pure, with `now` an argument, so tests/composables/personCard.test.ts can
 * walk it against plain objects. */
import type { Person } from "~~/shared/model";
import { asArray } from "~~/shared/model";
import { displayRole } from "~~/shared/companyBodies";
import { categoryTitle } from "~~/shared/companyCategories";
import { withoutRedundantRoleless } from "~~/shared/rolelessSpells";
import { truncateDescription } from "~/composables/entitySeo";
import {
  edgeCompany,
  employmentSpell,
  relationsPlural,
  type EdgeNode,
} from "~/composables/edges";
import { relationPeriodLabel } from "~/utils/relationPeriod";

/** How many rows the card has room for. */
export const PERSON_CARD_ROWS = 3;

/** A bar's ends, in thousandths of the axis. */
export const BAR_SCALE = 1000;

/** The flat prop bag `PersonCard.satori.vue` takes: scalars, which
 * nuxt-og-image puts into the url one by one, rather than objects, which it
 * would base64 whole. `name` rather than `title`, as on the node card: the
 * module fills a prop called `title` with the page's <title>. */
export interface PersonCardProps {
  name: string;
  /** 56, 48 or 40: the name and its chips share one line while they fit. */
  nameSize: number;
  /** The parties the page lists beside the name, in its order; `""` for none. */
  party1: string;
  party2: string;
  party3: string;
  row1Name: string;
  row1Role: string;
  /** `"1"` for an institution confirmed public: the page's sage chip. */
  row1Public: string;
  row1Sector: string;
  row1Period: string;
  /** Where the post sits on the shared axis, in thousandths. */
  row1From: number;
  row1To: number;
  row2Name: string;
  row2Role: string;
  row2Public: string;
  row2Sector: string;
  row2Period: string;
  row2From: number;
  row2To: number;
  row3Name: string;
  row3Role: string;
  row3Public: string;
  row3Sector: string;
  row3Period: string;
  row3From: number;
  row3To: number;
  /** „+ 35 powiązań” below the rows, or `""` when the card shows them all. */
  more: string;
}

export interface PersonPageCardInput {
  person: Person;
  /** The relations the page's history gets: both directions. */
  edges: EdgeNode[];
  now?: Date;
}

/** The longest an institution's registry name may run before the row
 * ellipsizes it; the card clips at its width as well. */
const ROW_NAME_LIMIT = 70;

const YEAR_MS = 365 * 24 * 3600 * 1000;

function nameSizeFor(name: string, parties: number): number {
  const room = name.length + parties * 4;
  if (room <= 26) return 56;
  if (room <= 34) return 48;
  return 40;
}

function day(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? fallback : time;
}

/** The row's second line: the role, or for a candidacy what it was for. */
function roleOf(edge: EdgeNode): string {
  if (edge.type === "election") {
    return edge.position ? `${edge.label} · ${edge.position}` : edge.label;
  }
  return displayRole(edge.label, edgeCompany(edge)) ?? edge.label;
}

/** Newest start first, and an undated row on top, as the page sorts. */
function byStartDesc(a: EdgeNode, b: EdgeNode): number {
  if (!a.start_date) return -1;
  if (!b.start_date) return 1;
  return b.start_date.localeCompare(a.start_date);
}

type Row = {
  name: string;
  role: string;
  isPublic: string;
  sector: string;
  period: string;
  from: number;
  to: number;
};

const EMPTY_ROW: Row = {
  name: "",
  role: "",
  isPublic: "",
  sector: "",
  period: "",
  from: 0,
  to: 0,
};

export function personPageCardProps(
  input: PersonPageCardInput,
): PersonCardProps {
  const { person } = input;
  const now = (input.now ?? new Date()).getTime();

  // The page's list: one row per spell, the roleless duplicate dropped.
  const listed = withoutRedundantRoleless(input.edges, employmentSpell).filter(
    (edge) =>
      (edge.type === "employed" || edge.type === "election") &&
      (edge.richNode.type === "place" || edge.richNode.type === "region"),
  );
  const isPublic = (edge: EdgeNode) => edgeCompany(edge)?.isPublic === true;
  const shown = [
    ...listed.filter(isPublic).toSorted(byStartDesc),
    ...listed.filter((edge) => !isPublic(edge)).toSorted(byStartDesc),
  ].slice(0, PERSON_CARD_ROWS);

  // The axis: from the earliest start on the card to today.
  const starts = shown
    .map((edge) => day(edge.start_date, Number.NaN))
    .filter((time) => !Number.isNaN(time));
  const axisStart = Math.min(now - YEAR_MS, ...starts);
  const span = Math.max(1, now - axisStart);
  const at = (time: number) =>
    Math.round(
      Math.max(0, Math.min(BAR_SCALE, ((time - axisStart) / span) * BAR_SCALE)),
    );

  const rows: Row[] = shown.map((edge) => {
    const company = edgeCompany(edge);
    const start = day(edge.start_date, axisStart);
    const end = day(edge.end_date || undefined, now);
    return {
      name: truncateDescription(edge.richNode.name.trim(), ROW_NAME_LIMIT),
      role: roleOf(edge),
      isPublic: company?.isPublic === true ? "1" : "",
      sector: company
        ? categoryTitle(asArray(company.categories).filter(Boolean)[0] ?? "")
        : "",
      period: relationPeriodLabel(edge.start_date, edge.end_date || undefined),
      from: at(start),
      to: at(Math.max(start, end)),
    };
  });
  const row = (i: number) => rows[i] ?? EMPTY_ROW;

  const parties = asArray(person.parties).filter(Boolean).slice(0, 3);
  const hidden = listed.length - rows.length;
  const name = person.name.trim();

  return {
    name,
    nameSize: nameSizeFor(name, parties.length),
    party1: parties[0] ?? "",
    party2: parties[1] ?? "",
    party3: parties[2] ?? "",
    row1Name: row(0).name,
    row1Role: row(0).role,
    row1Public: row(0).isPublic,
    row1Sector: row(0).sector,
    row1Period: row(0).period,
    row1From: row(0).from,
    row1To: row(0).to,
    row2Name: row(1).name,
    row2Role: row(1).role,
    row2Public: row(1).isPublic,
    row2Sector: row(1).sector,
    row2Period: row(1).period,
    row2From: row(1).from,
    row2To: row(1).to,
    row3Name: row(2).name,
    row3Role: row(2).role,
    row3Public: row(2).isPublic,
    row3Sector: row(2).sector,
    row3Period: row(2).period,
    row3From: row(2).from,
    row3To: row(2).to,
    more: hidden > 0 ? `+ ${hidden} ${relationsPlural(hidden)}` : "",
  };
}
