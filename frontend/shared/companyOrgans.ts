/** Which organ the register itself names as supervising an institution.
 *
 * Not to be confused with `companyBodies.ts`, which answers a different
 * question and is the one anything about pay must ask. That module reads the
 * *legal form*: an SPZOZ has a rada społeczna and cannot have a rada
 * nadzorcza, so the form settles it for all 243 of them and settles it for
 * every other company too. This module reads `dzial2.organNadzoru` - what the
 * entry actually filed - which is finer, and incomplete: 719 of the 1,192
 * SPZOZ in the crawl register no supervisory organ at all, because a rada
 * społeczna is created by statute rather than by an entry. So a value here can
 * say a board is unpaid but never that one is paid, and nothing computing
 * employment reads it.
 *
 * What it is for is reporting. /eksploruj/szpitale breaks hospital board seats
 * down by party, and a reader of that page wants to know which hospitals are
 * supervised by a komisja rewizyjna, which by something else again, and which
 * filed nothing - distinctions `supervisoryBody` deliberately collapses.
 *
 * And naming. Every supervisory seat is stored as "Rada Nadzorcza", so where
 * the form says nothing about the organ, `supervisoryOrganTitle` in
 * `companyBodies.ts` reads the value here to call a stowarzyszenie's seat
 * what the register calls it. That is a label, not a rule: it changes no
 * count.
 *
 * The values are normalized upstream by
 * `data/pipelines/src/scrapers/krs/organs.py` and arrive on the node as
 * `supervisoryOrgan` through `/api/ingest/company`. This is only the
 * vocabulary and the labels, the same division of labour
 * `companyCategories.ts` and `companyBodies.ts` have.
 */

export const supervisoryOrgans = [
  /** A commercial-company board. Its seats may be paid, and usually are. */
  "rada_nadzorcza",
  /** The statutory organ of an SPZOZ. Its seats are unpaid. */
  "rada_spoleczna",
  /** The audit committee of a stowarzyszenie or spółdzielnia. */
  "komisja_rewizyjna",
  /** Something else the register named: rada fundacji, rada izby, a ministry. */
  "inny",
  /** An organ is registered but it has no name. */
  "nieznany",
  /** The entry registers no supervisory organ whatsoever. Common for an SPZOZ,
   * whose rada społeczna is created by statute and often never filed. */
  "brak",
] as const;

export type SupervisoryOrgan = (typeof supervisoryOrgans)[number];

/** What to call each organ on screen.
 *
 * `brak` says what the register did, not what the institution has: an SPZOZ
 * that filed no organ still has a rada społeczna. Worded so a reader of
 * /eksploruj/szpitale does not read the row as "unsupervised".
 */
export const supervisoryOrganLabels: Record<SupervisoryOrgan, string> = {
  rada_nadzorcza: "Rada nadzorcza",
  rada_spoleczna: "Rada społeczna",
  komisja_rewizyjna: "Komisja rewizyjna",
  inny: "Inny organ",
  nieznany: "Organ bez nazwy",
  brak: "Brak organu w KRS",
};

/** The label, or "Nie sprawdzono" for an institution the pipelines have not
 * reached since the field was added - which is not the same as `brak`. */
export function supervisoryOrganLabel(
  organ: SupervisoryOrgan | null | undefined,
): string {
  return organ ? supervisoryOrganLabels[organ] : "Nie sprawdzono";
}
