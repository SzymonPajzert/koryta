import { authCachedEventHandler } from "~~/server/utils/handlers";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import { gameDateValidator, warsawToday } from "~~/server/utils/games";
import { asArray } from "~~/shared/model";
import type { Edge } from "~~/shared/model";
import {
  sameDayPeers,
  successionsAtCompany,
  type SuccessionSpell,
} from "~~/shared/succession";
import { displayRole } from "~~/shared/companyBodies";
import { gameEntry } from "~~/shared/games/registry";
import {
  kiedyIsAskable,
  kiedyPuzzleNumber,
  kiedySlug,
  kiedyFirstYear,
  pickKiedySwaps,
  type KiedyPuzzle,
  type KiedySwap,
} from "~~/shared/games/kiedy";

/** Today's six handovers.
 *
 * The pool is every seat change the site would already show on a profile, and
 * deliberately no more than that: `shared/succession.ts` does the pairing, so
 * a card here and the "Zmiany na stanowisku" section on the two people's own
 * pages cannot disagree about who replaced whom. A player who checks is meant
 * to find the same answer.
 *
 * Only `employed` edges take part. Election edges carry a start date the
 * ingest made up - `${year}-01-01`, see the pipeline's site payload - so a
 * game asking for a date would be asking players to guess a fiction.
 */

/** Only handovers where both people have a page of their own.
 *
 * The successions endpoint is looser: it counts a handover it cannot name and
 * says so, because a profile is better off admitting a gap than hiding one. A
 * quiz has no such excuse - it would be naming an unreviewed person on a
 * public page for entertainment - so this is the stricter of the two rules.
 */
function nameable(
  person:
    { name?: string; visibility?: boolean; deleted?: boolean } | undefined,
): boolean {
  return !!person?.name && !!person.visibility && !person.deleted;
}

export default authCachedEventHandler(async (event) => {
  const { date } = await getValidatedQuery(event, (query) =>
    gameDateValidator.parse(query),
  );
  const day = date ?? warsawToday();
  const lastYear = Number(day.slice(0, 4));

  const [people, places, edges] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchEdges(),
  ]);

  /** Employment spells per company, which is the unit the pairing works on. */
  const spellsByCompany = new Map<string, SuccessionSpell[]>();
  for (const edge of edges as Edge[]) {
    if (edge.type !== "employed" || !edge.visibility || edge.deleted) continue;
    if (!edge.id || !edge.source || !edge.target) continue;
    const spells = spellsByCompany.get(edge.target);
    const spell: SuccessionSpell = {
      id: edge.id,
      personId: edge.source,
      role: edge.name ?? null,
      start: edge.start_date ?? null,
      end: edge.end_date ?? null,
    };
    if (spells) spells.push(spell);
    else spellsByCompany.set(edge.target, [spell]);
  }

  const pool: KiedySwap[] = [];
  for (const [companyId, spells] of spellsByCompany) {
    const company = places[companyId];
    if (!company?.name || !company.visibility || company.deleted) continue;

    const pairs = successionsAtCompany(spells);
    for (const pair of pairs) {
      const left = people[pair.left.personId];
      const joined = people[pair.joined.personId];
      if (!nameable(left) || !nameable(joined)) continue;
      // The day the arriving spell began is what the change is filed under.
      const startedAt = pair.joined.start;
      if (!startedAt) continue;

      const swap: KiedySwap = {
        id: `${pair.left.id}-${pair.joined.id}`,
        companyName: company.name,
        role:
          displayRole(pair.joined.role ?? undefined, company) ??
          pair.joined.role ??
          "",
        gapDays: pair.gapDays,
        batchSize: sameDayPeers(pairs, pair),
        left: { name: left!.name!, parties: asArray(left!.parties) },
        joined: { name: joined!.name!, parties: asArray(joined!.parties) },
        answer: Number(startedAt.slice(0, 4)),
      };
      if (kiedyIsAskable(swap, lastYear)) pool.push(swap);
    }
  }

  const swaps = pickKiedySwaps(day, pool);
  if (swaps.length < 1) {
    throw createError({
      statusCode: 503,
      statusMessage: "Nie udało się przygotować dzisiejszej zagadki",
    });
  }

  const puzzle: KiedyPuzzle = {
    date: day,
    number: kiedyPuzzleNumber(gameEntry(kiedySlug).firstDay, day),
    swaps,
    firstYear: kiedyFirstYear,
    lastYear,
  };
  return puzzle;
});
