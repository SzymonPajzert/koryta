import { asArray, pageIsPublic, type Edge } from "./model";
import { OTHER_PARTY, sortParties } from "./misc";
import { isPublicEmployment } from "./stats";

/** „Inne” as the least a published page names, where it shows a candidacy and
 * a paid public post (decision on 2026-11-18).
 *
 * Standing for election is a political tie whatever the list, but a local
 * one, a KWW, names none of the site's parties (`committee_to_party` in
 * data/pipelines/src/scrapers/pkw/elections.py gives it none, on purpose). So
 * a councillor on a KWW list with a seat on a public company's board read as
 * nobody's: 260 published pages on the 2026-11-18 export, 235 of them put up
 * by the declarations automation.
 *
 * Written where a page goes up (`publishPage` in
 * server/utils/declarationPublish.ts) and onto the pages that were up already
 * (scripts/migrate/inne-for-published-candidates.ts); the night counts any
 * page still without one
 * (`test_a_published_candidate_with_a_paid_post_names_a_party`).
 */

/** The relation fields the rule reads. */
type Relation = Pick<Edge, "type" | "target" | "name"> & {
  published?: boolean;
  deleted?: boolean;
};

/** The company fields `isPublicEmployment` reads. */
type Company = {
  isPublic?: boolean;
  supervisoryBody?: string;
  paidSeats?: boolean;
};

/** Whether these relations show a candidacy and a paid public post, both of
 * them live. */
export function showsCandidacyAndPaidPost(
  relations: readonly Relation[],
  companyOf: (id: string) => Company | undefined | null,
): boolean {
  const live = relations.filter((relation) => pageIsPublic(relation));
  return (
    live.some((relation) => relation.type === "election") &&
    live.some((relation) =>
      isPublicEmployment(relation, companyOf(relation.target)),
    )
  );
}

/** The parties to store on a page `showsCandidacyAndPaidPost` is true of, or
 * null where it keeps its own: a page naming a party already, or one whose
 * list a person set (`partiesSource`), which only a person changes. */
export function partyFloor(person: {
  parties?: string[] | Record<string, string> | null;
  partiesSource?: string | null;
}): string[] | null {
  if (person.partiesSource === "manual") return null;
  if (asArray(person.parties).length > 0) return null;
  return [OTHER_PARTY];
}

/** The parties an import leaves on a page whose list no person set: its own
 * and the payload's together, except that a lone „Inne” the payload does not
 * name gives way to the parties it does. That „Inne” is this floor, or an
 * older reading the pipeline has since dropped, and would otherwise stand
 * beside the party the page now names. */
export function partiesAfterImport(
  stored: readonly string[],
  sent: readonly string[],
): string[] {
  const floorAlone =
    stored.length === 1 &&
    stored[0] === OTHER_PARTY &&
    sent.length > 0 &&
    !sent.includes(OTHER_PARTY);
  return sortParties(new Set([...(floorAlone ? [] : stored), ...sent]));
}
