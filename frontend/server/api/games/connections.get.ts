import { authCachedEventHandler } from "~~/server/utils/handlers";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import { gameDateValidator, warsawToday } from "~~/server/utils/games";
import { toStringArray } from "~~/shared/games/util";
import {
  generateConnectionsPuzzle,
  type ConnectionsCandidate,
} from "~~/shared/games/connections";

export default authCachedEventHandler(async (event) => {
  const { date } = gameDateValidator.parse(getQuery(event));
  const day = date ?? warsawToday();

  const [people, places, regions, edges] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("region"),
    fetchEdges(),
  ]);

  const candidates = new Map<string, ConnectionsCandidate>();
  for (const person of Object.values(people)) {
    if (!person.id || !person.name || !person.visibility || person.deleted) {
      continue;
    }
    candidates.set(person.id, {
      id: person.id,
      name: person.name,
      parties: toStringArray(person.parties),
      companies: [],
      regions: [],
      years: [],
    });
  }

  for (const edge of edges) {
    if (!edge.visibility || edge.deleted) continue;
    const candidate = candidates.get(edge.source);
    if (!candidate) continue;
    if (edge.type === "employed" && places[edge.target]?.visibility) {
      candidate.companies.push(edge.target);
    } else if (edge.type === "election" && regions[edge.target]?.visibility) {
      candidate.regions.push(edge.target);
      const year =
        typeof edge.start_date === "string"
          ? edge.start_date.slice(0, 4)
          : undefined;
      if (year) candidate.years.push(year);
    }
  }

  const puzzle = generateConnectionsPuzzle(day, [...candidates.values()], {
    company: (id) => places[id]?.name,
    region: (id) => regions[id]?.name,
  });

  if (!puzzle) {
    throw createError({
      statusCode: 503,
      statusMessage: "Nie udało się wygenerować układanki na ten dzień",
    });
  }

  return puzzle;
});
