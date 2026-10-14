import { defineEventHandler, readBody, getRouterParam } from "h3";
import { getLocalGraph } from "~~/server/utils/localGraph";
import { bodyWantsLatest } from "~~/server/utils/handlers";

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) || {};
  // Asked for in the body and allowed by the token. The table sent
  // `latest: true` for every reader until 2026-10-14, and this took it at its
  // word, so the flag by itself is no sign of anybody signed in.
  const latest = await bodyWantsLatest(event, body);
  const distance = body.distance ? parseInt(body.distance as string, 10) : 1;
  const focusNodeId = getRouterParam(event, "id");

  if (!focusNodeId) {
    throw createError({ statusCode: 400, statusMessage: "id is required" });
  }

  const list = (value: unknown): string[] => {
    if (!value) return [];
    return (typeof value === "string" ? value.split(",") : (value as string[]))
      .map((id) => id.trim())
      .filter(Boolean);
  };

  // `subjects` and `expand` are not the same request. The table sends the
  // other nine rows of the page as `subjects` - it wants each of their
  // neighbourhoods in full - where an `expand` is one node a reader on the
  // canvas asked to see more of, drawn a ring out from whoever the page is
  // about. See `getLocalGraph`.
  return getLocalGraph(
    focusNodeId,
    latest,
    distance,
    list(body.expand),
    list(body.subjects),
  );
});
