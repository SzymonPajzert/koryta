import { authCachedEventHandler } from "~~/server/utils/handlers";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import { gameDateValidator, warsawToday } from "~~/server/utils/games";
import powiatyPaths from "~~/app/assets/poland_powiaty.json";
import type { Edge } from "~~/shared/model";
import { toStringArray } from "~~/shared/games/util";
import {
  branzaFromCompany,
  korytlePuzzleNumber,
  pickKorytleAnswer,
  powiatCentroids,
  terytToPowiat,
  korytleNoParty,
  type KorytleCell,
  type KorytleOption,
  type KorytlePersonReveal,
  type KorytlePuzzle,
} from "~~/shared/games/korytle";

/** A region qualifies as the daily answer with at least this many people. */
const minPeople = 8;

const centroids = powiatCentroids(powiatyPaths);

/** Region and its transitively owned places, following `owns` edges. */
function clusterPlaces(
  regionId: string,
  ownsBySource: Map<string, string[]>,
): Set<string> {
  const places = new Set<string>();
  const queue = [regionId];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const nodeId = queue.pop()!;
    for (const target of ownsBySource.get(nodeId) ?? []) {
      if (visited.has(target)) continue;
      visited.add(target);
      places.add(target);
      queue.push(target);
    }
  }
  return places;
}

export default authCachedEventHandler(async (event) => {
  const { date } = gameDateValidator.parse(getQuery(event));
  const day = date ?? warsawToday();

  const [people, places, regions, edges] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("region"),
    fetchEdges(),
  ]);

  const visibleEdges = edges.filter((edge) => edge.visibility && !edge.deleted);
  const ownsBySource = new Map<string, string[]>();
  const employedByPlace = new Map<string, Edge[]>();
  for (const edge of visibleEdges) {
    if (edge.type === "owns") {
      if (!ownsBySource.has(edge.source)) ownsBySource.set(edge.source, []);
      ownsBySource.get(edge.source)!.push(edge.target);
    } else if (edge.type === "employed") {
      if (!employedByPlace.has(edge.target))
        employedByPlace.set(edge.target, []);
      employedByPlace.get(edge.target)!.push(edge);
    }
  }

  const options: KorytleOption[] = [];
  const optionById = new Map<string, KorytleOption>();
  for (const region of Object.values(regions)) {
    if (!region.id || !region.name || !region.visibility || region.deleted) {
      continue;
    }
    // Some stored regions miss the teryt field; their id ("teryt1261") works.
    const teryt = (region.teryt as string | undefined) ?? region.id;
    const powiat = terytToPowiat(teryt);
    const centroid = powiat && centroids.get(powiat);
    if (!centroid) continue;
    const option: KorytleOption = {
      id: region.id,
      name: region.name,
      teryt,
      lat: Number(centroid.lat.toFixed(3)),
      lng: Number(centroid.lng.toFixed(3)),
    };
    options.push(option);
    optionById.set(option.id, option);
  }
  options.sort((a, b) => a.name.localeCompare(b.name, "pl"));

  /** People reveal entries per region that has enough of them. */
  const regionPeople = new Map<string, KorytlePersonReveal[]>();
  for (const option of optionById.values()) {
    const reveal = new Map<string, KorytlePersonReveal>();
    for (const placeId of clusterPlaces(option.id, ownsBySource)) {
      const place = places[placeId];
      if (!place?.visibility || place.deleted) continue;
      const branza = branzaFromCompany(place.activity, place.categories);
      for (const edge of employedByPlace.get(placeId) ?? []) {
        const person = people[edge.source];
        if (!person?.id || !person.name || !person.visibility || person.deleted)
          continue;
        if (reveal.has(person.id)) continue;
        const party = toStringArray(person.parties)[0];
        reveal.set(person.id, {
          id: person.id,
          name: person.name,
          party,
          branza,
          company: place.name,
        });
      }
    }
    if (reveal.size >= minPeople) {
      regionPeople.set(option.id, [...reveal.values()]);
    }
  }

  const answerId = pickKorytleAnswer(day, [...regionPeople.keys()]);
  const answer = answerId && optionById.get(answerId);
  if (!answerId || !answer) {
    throw createError({
      statusCode: 503,
      statusMessage: "Nie udało się wygenerować układanki na ten dzień",
    });
  }

  const revealPeople = regionPeople.get(answerId)!;
  const cellCounts = new Map<string, KorytleCell>();
  for (const person of revealPeople) {
    const party = person.party ?? korytleNoParty;
    const key = `${person.branza}|${party}`;
    if (!cellCounts.has(key)) {
      cellCounts.set(key, { branza: person.branza, party, count: 0 });
    }
    cellCounts.get(key)!.count += 1;
  }

  const puzzle: KorytlePuzzle = {
    date: day,
    number: korytlePuzzleNumber(day),
    answer,
    cells: [...cellCounts.values()].sort((a, b) => b.count - a.count),
    totalPeople: revealPeople.length,
    people: revealPeople.sort((a, b) => a.name.localeCompare(b.name, "pl")),
    options,
  };
  return puzzle;
});
