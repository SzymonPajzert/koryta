import { defineEventHandler, getRouterParam } from "h3";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { oneRun } from "~~/server/utils/jobRequests";

/** One run, for `/admin/procesy#przebieg-<id>`: a reported or asked-for run,
 * or a capture, wherever it is in the list - or not in it at all, which an
 * older capture the extension links to may well be. */
export default defineEventHandler(async (event) => {
  requireDatascience(await getUser(event));
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, message: "Brak id." });
  const run = await oneRun(id);
  if (!run) {
    throw createError({ statusCode: 404, message: "Nie ma takiego procesu." });
  }
  return { run };
});
