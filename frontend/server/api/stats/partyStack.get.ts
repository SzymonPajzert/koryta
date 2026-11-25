import { z } from "zod";
import { getValidatedQuery } from "h3";
import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import {
  postTimelines,
  type PartyStackResponse,
} from "~~/server/utils/postTimelines";
import { companyCategoryValues } from "~~/shared/companyCategories";
import { warsawDate } from "~~/shared/dates";

export type { PartyStackResponse } from "~~/server/utils/postTimelines";

/** One of the categories the site offers, or none for every institution. A
 * closed list, so a junk value is refused rather than given a cache entry. */
const queryValidator = z.object({
  category: z.enum(companyCategoryValues).optional(),
});

/** How many people held a post each month, one band per party, for the
 * „Partie w czasie” chart on /eksploruj/autograf: in every institution, or
 * in one category of them. Cut from the home timeline's scan and cached the
 * same way, each category under its own url. */
export default editorFreshCachedEventHandler(
  async (event): Promise<PartyStackResponse> => {
    const { category } = await getValidatedQuery(event, (query) =>
      queryValidator.parse(query),
    );
    const { stacks } = await postTimelines(warsawDate());
    return category ? stacks.byCategory[category] : stacks.all;
  },
  { name: "api-stats-partyStack" },
);
