import { defineEventHandler, readBody, getRouterParam } from "h3";
import { getLocalGraph } from "./[id].get";

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) || {};
  const latest = body.latest !== undefined && body.latest !== false;
  const distance = body.distance ? parseInt(body.distance as string, 10) : 1;
  const focusNodeId = getRouterParam(event, "id");

  if (!focusNodeId) {
    throw createError({ statusCode: 400, statusMessage: "id is required" });
  }

  let expansions: string[] = [];
  if (body.expand) {
    expansions =
      typeof body.expand === "string" ? body.expand.split(",") : body.expand;
  }

  return getLocalGraph(focusNodeId, latest, distance, expansions);
});
