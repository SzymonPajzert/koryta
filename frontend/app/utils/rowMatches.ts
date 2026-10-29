import type { PersonRich } from "~~/shared/model";
import type { PlaceRegion } from "~/utils/companyLocation";
import { isCurrentPost } from "~~/shared/stats";

/** One `employed` relation of a row's person, as the graph endpoint hands it:
 * the place, what it is called, and the edge's own fields. */
export type RowEmployment = {
  placeId: string;
  name: string;
  edge: { type?: string; end_date?: string | null };
};

export type RowMatchOptions = {
  /** The region each company is seated in, from `useCompanyLocations`. */
  seats?: Record<string, PlaceRegion>;
  /** What to call the places among `hits` - the api's `matchedPlaces`. */
  matchedPlaces: Record<string, string>;
  /** The page asks for posts held now (`currentlyEmployed=selected`). */
  currentOnly: boolean;
};

/** Which of a row's companies put the person on the page, from the ids the
 * api says did (`hits`, see `matchedTargets` in server/utils/nodeFilters.ts).
 *
 * An employer among them is a match of the company filters. An employer
 * seated in a region among them is a match of the region filter - but a seat
 * says nothing about which of the person's posts matched, so under
 * `currentOnly` only a post still held counts, as it does in the api. And
 * where no employer of theirs matched at all, the companies among `hits` are
 * the ones above an employer that the filters reached through ownership, and
 * the row names them.
 *
 * Nothing at all without `hits`, which is how a row tells "the page sets no
 * such filter" from "none of these matched". */
export function rowMatches(
  employments: RowEmployment[],
  hits: ReadonlySet<string> | undefined,
  { seats, matchedPlaces, currentOnly }: RowMatchOptions,
): Pick<
  PersonRich,
  "matchedCompanies" | "seatedInMatchedRegion" | "matchedThrough"
> {
  if (!hits) return {};

  const matched = new Set<string>();
  const seated = new Set<string>();
  for (const { placeId, name, edge } of employments) {
    if (hits.has(placeId)) {
      matched.add(name);
      continue;
    }
    const seat = seats?.[placeId]?.id;
    if (seat && hits.has(seat) && (!currentOnly || isCurrentPost(edge))) {
      seated.add(name);
    }
  }

  const own = new Set(employments.map((employment) => employment.placeId));
  const through =
    matched.size === 0 && seated.size === 0
      ? [...hits]
          .filter((id) => !own.has(id))
          .map((id) => matchedPlaces[id])
          .filter((name): name is string => !!name)
      : [];

  return {
    matchedCompanies: [...matched],
    // Two employers can share a name, and the row draws one chip for both.
    seatedInMatchedRegion: [...seated].filter((name) => !matched.has(name)),
    matchedThrough: through,
  };
}
