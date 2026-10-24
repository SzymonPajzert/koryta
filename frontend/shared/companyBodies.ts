/** What an institution's supervisory organ is called, and whether a seat on it
 * is a job.
 *
 * Every supervisory seat the register holds reaches the site as an `employed`
 * edge named "Rada Nadzorcza": rejestr.io reports all of them as one connection
 * type, `KRS_SUPERVISION`, and `data/pipelines/src/scrapers/krs/list.py` gives
 * that type a single label. 9,848 of the 15,235 stored employment edges say it.
 *
 * For a spółka that is right, and a board seat is the sort of post the site
 * exists to record. For a samodzielny publiczny zakład opieki zdrowotnej it is
 * wrong twice over. KRS names the organ itself - `dzial2.organNadzoru` reads
 * "RADA SPOŁECZNA" for every one of them - and a rada społeczna is not a
 * supervisory board at all but the advisory body art. 48 ustawy o działalności
 * leczniczej makes each hospital appoint, whose members are delegates of the
 * founding authority and are not paid. 892 such seats are stored, across the
 * 238 hospitals that have any, every one of them labelled "Rada Nadzorcza".
 *
 * So this is the vocabulary, and which institution has which organ is decided
 * by the pipelines, in `data/pipelines/src/entities/company_bodies.py`, and
 * arrives on the node as `supervisoryBody` through `/api/ingest/company` - the
 * same division of labour `companyCategories.ts` has, and for the same reason:
 * the answer comes from the register's `formaPrawna`, which the site never
 * sees.
 *
 * The *name* has a second source, which the pay rule deliberately does not
 * use: the organ the register lists, which reaches the node as
 * `supervisoryOrgan` (see `companyOrgans.ts`). The form settles the name only
 * where a statute does. A stowarzyszenie, a cech or an izba gospodarcza is
 * supervised by whatever its statut calls the organ, nearly always a komisja
 * rewizyjna. On 2026-10-24 the 366 institutions whose register lists a
 * komisja rewizyjna held 979 stored seats, and every one of them read "Rada
 * Nadzorcza" - Związek Miast Polskich's among them. See
 * `supervisoryOrganTitle`.
 */

import type { SupervisoryOrgan } from "./companyOrgans";

export const supervisoryBodies = [
  {
    value: "rada-nadzorcza",
    title: "Rada Nadzorcza",
    /** Whether sitting here is a post the site counts as employment. */
    paidPost: true,
  },
  { value: "rada-spoleczna", title: "Rada Społeczna", paidPost: false },
] as const satisfies readonly {
  value: string;
  title: string;
  paidPost: boolean;
}[];

export type SupervisoryBody = (typeof supervisoryBodies)[number]["value"];

/** The body values, as a tuple, for `z.enum` and for anything checking that a
 * stored value is still one the site knows about. */
export const supervisoryBodyValues = supervisoryBodies.map((b) => b.value) as [
  SupervisoryBody,
  ...SupervisoryBody[],
];

/** What the register calls this organ.
 *
 * Falls back to the stored value for a body the pipelines know about and this
 * list does not yet - the two deploy separately - so the label is visible
 * rather than blank when something needs adding here.
 */
export function supervisoryBodyTitle(value: string): string {
  return supervisoryBodies.find((b) => b.value === value)?.title ?? value;
}

/** What a seat is called where the register names the organ outright.
 *
 * Only the organs `organs.py` can tell apart by name. `inny` is a rada
 * fundacji, a rada izby or a minister, and the node does not say which, so a
 * seat there keeps the name it was stored under rather than trading one wrong
 * word for a guess; `nieznany` and `brak` say nothing about the organ at all.
 */
const registerOrgans = [
  { organ: "rada_nadzorcza", title: "Rada Nadzorcza" },
  { organ: "rada_spoleczna", title: "Rada Społeczna" },
  { organ: "komisja_rewizyjna", title: "Komisja Rewizyjna" },
] as const satisfies readonly { organ: SupervisoryOrgan; title: string }[];

/** What this institution's supervisory organ is called, where anything says.
 *
 * The legal form first: where it has an answer the answer is a statute's, and
 * it holds for the 719 SPZOZ that filed no organ at all. Then the organ the
 * register lists, which is the evidence for everything else. Undefined where
 * neither says, and the stored "Rada Nadzorcza" then stands.
 *
 * The register's answer is one per institution, so at the few that list two
 * organs (20 of 7,840 in the crawl) the seats on both are named after the one
 * `organs.py` ranks first.
 */
export function supervisoryOrganTitle(
  company:
    { supervisoryBody?: string; supervisoryOrgan?: string } | undefined | null,
): string | undefined {
  if (company?.supervisoryBody) {
    return supervisoryBodyTitle(company.supervisoryBody);
  }
  const organ = company?.supervisoryOrgan;
  return registerOrgans.find((o) => o.organ === organ)?.title;
}

/** Whether a seat on this organ counts as employment.
 *
 * `undefined` is true, and that is the whole of the default: an institution
 * whose form nobody read, or one the pipelines have nothing special to say
 * about, keeps counting its supervisory seats exactly as the site did before
 * this module existed. Only a body explicitly recorded as unpaid changes
 * anything, which is the same direction `Company.isPublic` errs in.
 */
export function bodyIsPaidPost(value: string | undefined | null): boolean {
  if (!value) return true;
  return supervisoryBodies.find((b) => b.value === value)?.paidPost ?? true;
}

/** Polish, lowercased and stripped of its diacritics, for comparing role text.
 *
 * Roles are free text: 9,848 edges say "Rada Nadzorcza" and another 29 say the
 * same thing in nine other spellings - "rada nadzorcza", "członek rady
 * nadzorczej", "Przewodniczący Rady Nadzorczej" - because /api/edges/create
 * takes whatever a reviewer types. Anything comparing them has to fold case
 * and diacritics or it reads a hand-entered seat as something else entirely.
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase();
}

/** Whether a role names a seat on the company's supervisory organ, rather than
 * a post in its management.
 *
 * Both wordings, because both occur and both mean the same seat: the stored
 * edges say "Rada Nadzorcza" whatever the register calls the organ, and a
 * reviewer entering one by hand at a hospital may well write "Rada Społeczna".
 *
 * Deliberately narrow. "Zarząd" is not a match, which is what keeps the 16
 * stored `Zarząd` edges at SPZOZ hospitals - their kierownik, a salaried
 * director - counted as the employment they are. Neither is "rada powiatu",
 * "radny dzielnicy" or "doradca społeczny": the organ's name is two words and
 * both have to be there.
 */
export function namesASupervisorySeat(
  role: string | undefined | null,
): boolean {
  if (!role) return false;
  return /\brad\w*\s+(nadzorcz|spolecz)\w*/.test(fold(role));
}

/** Every bare organ name the site gives, from either source, folded - what a
 * role has to be for `displayRole` to read it as the organ itself. */
const organNames = new Set(
  [...supervisoryBodies, ...registerOrgans].map((o) => fold(o.title)),
);

/** The role as it should read, given what supervises the institution.
 *
 * Every supervisory seat is stored as "Rada Nadzorcza" whatever the register
 * calls the organ, so a hospital's page says its rada społeczna is a
 * supervisory board, and an association's page says the same of its komisja
 * rewizyjna. This is what puts the register's own word back on screen,
 * without touching the stored edge - `employed` edges are identified by their
 * name (see `EDGE_SEMANTICS` in `server/utils/edges.ts`), so rewriting one
 * would change its document id and the next ingest would store the seat a
 * second time under the old name.
 *
 * Only the bare organ name is rewritten. "Przewodniczący Rady Nadzorczej" is
 * left exactly as it stands: a spelled-out role was typed by a person through
 * /api/edges/create, and inflecting somebody's sentence into a different organ
 * is putting words in their mouth. All 892 stored SPZOZ seats and all 979
 * komisja rewizyjna ones say the bare name, so nothing real is missed by being
 * careful here.
 */
export function displayRole(
  role: string | undefined | null,
  company:
    { supervisoryBody?: string; supervisoryOrgan?: string } | undefined | null,
): string | undefined {
  const title = supervisoryOrganTitle(company);
  // `|| undefined` rather than `?? undefined`: an edge with `name: ""` has no
  // role at all - /api/edges/create writes one for every box the form left
  // blank - and a caller asking for the role of one wants nothing back, not an
  // empty string it has to check for itself.
  if (!role || !title) return role || undefined;
  if (!organNames.has(fold(role.trim()))) return role;
  return title;
}
