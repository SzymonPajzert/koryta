import { defineEventHandler, getValidatedQuery } from "h3";
import { z } from "zod";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { runsForNode } from "~~/server/utils/jobRequests";

const querySchema = z.object({ node: z.string().min(1).max(200) });

/** The runs asked for on one page, newest first: what its button shows. */
export default defineEventHandler(async (event) => {
  requireDatascience(await getUser(event));
  const { node } = await getValidatedQuery(event, (query) =>
    querySchema.parse(query),
  );
  return { runs: await runsForNode(node) };
});
