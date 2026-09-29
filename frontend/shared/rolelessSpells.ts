/** A role nobody recorded, next to the same person's role that somebody did.
 *
 * „Joanna Dudek jest wypisana dwa razy - jedno jako funkcja niepodana w
 * rejestrze a drugie jako prokurent” is the report, about PZO Gliwice. She is
 * one appointment stored twice. Until 2026-07-30 the KRS pipeline knew two
 * kinds of rejestr.io connection, the zarząd and the rada nadzorcza, and wrote
 * every other kind - prokura among them - as employment with no role; an upload
 * on 2026-08-01 stored her post that way. Once `KRS_RELATION_ROLES` named each
 * kind, the upload of 2026-08-18 wrote it again as „Prokurent”, from the same
 * day. That could not fill the first one in - an `employed` edge is identified
 * by its name and its start date, and is not enrichable (see `EDGE_SEMANTICS`
 * in server/utils/edges.ts) - so it landed beside it, and every list of her
 * posts printed both.
 *
 * Only a role the old pipeline could not name can have arrived twice like
 * this. A zarząd or rada nadzorcza seat was named all along, so a role-less
 * spell beside one is not a copy of it but a different post - a prokura taken
 * the day the board seat ended, a receivership, an owner. And the named side is
 * often stale itself: a board seat stored once closed and once still open makes
 * a prokura that began the day it ended look like it overlaps. So only a
 * „Prokurent” or „Pełnomocnik” spell may stand in for a role-less one.
 *
 * In the 2026-09-29 export that hides 35 of the 247 role-less employment edges
 * - 29 people at 23 companies, 22 of the copies still open, so „Obecny skład”
 * listed each of those people twice. All came from automatic uploads between
 * 2026-03-26 and 2026-08-01, and no upload has written a role-less post since.
 * A role-less spell beside a board seat stays, and so does one that shares no
 * time with the prokura - a stint that ended years before it began is a post of
 * its own.
 */

import { spellDate } from "./succession";

/** One spell of employment, as much of it as this rule reads. */
export type RoleSpell = {
  personId: string;
  companyId: string;
  /** The role as stored. Blank or absent is a role nobody recorded:
   * `/api/edges/create` writes `""` for an empty field, the ingest leaves it
   * out. */
  role: string | null | undefined;
  start: string | null | undefined;
  end: string | null | undefined;
};

function hasRole(spell: RoleSpell): boolean {
  return !!spell.role?.trim();
}

/** The roles a role-less spell can be a second copy of: what
 * `KRS_RELATION_ROLES` named on 2026-07-30 and the pipeline had written with no
 * role before. Lowercased, as `shared/succession.ts` compares a seat. */
const NAMED_SINCE_JULY = new Set(["prokurent", "pełnomocnik"]);

function canStandIn(spell: RoleSpell): boolean {
  return NAMED_SINCE_JULY.has(spell.role?.trim().toLowerCase() ?? "");
}

/** Whether a spell carries no date at all. Such a role-less spell is kept
 * whatever stands beside it: nothing about it says which post it is, and
 * somebody adding a relation by hand with no role and no dates should not see
 * it vanish on save. */
function undated(spell: RoleSpell): boolean {
  return spellDate(spell.start) === null && spellDate(spell.end) === null;
}

/** Whether two spells share any time.
 *
 * The same start is the same appointment, whatever the end dates say: the
 * register dates a post by the day it was entered, and a copy written before
 * the post ended can lack the end date its twin has.
 *
 * Otherwise the end is exclusive. A post that ends on the day the next one
 * begins is a change of function - prokurent until the morning they joined the
 * zarząd - and not the same post twice. A date nobody recorded reads as
 * unbounded on its side: an open spell runs to today, and one with no start
 * cannot be shown to have begun after the other ended.
 */
export function spellsOverlap(a: RoleSpell, b: RoleSpell): boolean {
  const aStart = spellDate(a.start);
  const bStart = spellDate(b.start);
  if (aStart !== null && aStart === bStart) return true;
  const aEnd = spellDate(a.end) ?? Infinity;
  const bEnd = spellDate(b.end) ?? Infinity;
  return (aStart ?? -Infinity) < bEnd && (bStart ?? -Infinity) < aEnd;
}

/** The items, less every dated role-less spell that a „Prokurent” or
 * „Pełnomocnik” spell - the same person's, at the same company - overlaps.
 *
 * Anything `spellOf` gives no spell for passes through untouched, so a caller
 * can hand over a whole relation list, candidacies and all. So does a
 * role-less spell with no such twin: „Funkcja niepodana w rejestrze” is all
 * anybody knows about that post, and it is still a post. Order is kept.
 */
export function withoutRedundantRoleless<T>(
  items: readonly T[],
  spellOf: (item: T) => RoleSpell | undefined,
): T[] {
  const spells = items.map(spellOf);
  const key = (spell: RoleSpell) => `${spell.personId}|${spell.companyId}`;

  const twins = new Map<string, RoleSpell[]>();
  for (const spell of spells) {
    if (!spell || !canStandIn(spell)) continue;
    const held = twins.get(key(spell));
    if (held) held.push(spell);
    else twins.set(key(spell), [spell]);
  }

  return items.filter((_, at) => {
    const spell = spells[at];
    if (!spell || hasRole(spell) || undated(spell)) return true;
    const rivals = twins.get(key(spell)) ?? [];
    return !rivals.some((rival) => spellsOverlap(spell, rival));
  });
}
