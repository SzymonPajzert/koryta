import { defineEventHandler, getRouterParam } from "h3";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { redispatch } from "~~/server/utils/jobRequests";

/** Start the machine again for a run still waiting for one. */
export default defineEventHandler(async (event) => {
  requireDatascience(await getUser(event));
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, message: "Brak id." });
  return { run: await redispatch(id) };
});
