import type { PlaceRegion } from "~/utils/companyLocation";
import type { ElectionRich } from "~~/shared/model";
import { terytCoversPowiat } from "~~/shared/teryt";

/** Why a place is on a person's map: they stood for election there, or they
 * hold a post there. */
export type PersonLocationKind = "election" | "work";

export type PersonLocation = {
  name: string;
  /** Absent where nothing tied the place to a TERYT code, which is what it
   * takes to draw it. Those places are listed beside the map instead. */
  teryt?: string;
  /** Both, where someone stood for election in the town that employs them. */
  kinds: PersonLocationKind[];
};

/** The elections a person stood in, read off the edges around them.
 *
 * A node fetched by its id carries no `elections` - only the table builds
 * those, and it builds them from the subgraph it fetches - so a page that
 * holds one node and its relations reconstructs them here instead, the same
 * way `useListWithStats` does. Earliest campaign first, as in the table.
 *
 * `teryt` is what puts the town on the map, and it is read through an `in`
 * guard because `shared/model`'s `Node` does not declare it: the local graph
 * spreads the whole region document into `richNode`, so a region carries one.
 */
export function electionsFromEdges(
  edges: {
    type?: string;
    name?: string;
    start_date?: string;
    position?: string;
    committee?: string;
    richNode?: { name?: string } | null;
  }[],
): ElectionRich[] {
  const elections: ElectionRich[] = [];

  for (const edge of edges) {
    const node = edge.richNode;
    if (edge.type !== "election" || !node?.name) continue;
    elections.push({
      year: edge.start_date?.split("-")[0],
      location: node.name,
      teryt: "teryt" in node ? (node.teryt as string) : undefined,
      position: edge.position || edge.name || "Wybory",
      committee: edge.committee,
    });
  }

  return elections.sort(
    (a, b) => parseInt(a.year || "0", 10) - parseInt(b.year || "0", 10),
  );
}

/** Every place a person is tied to, once each.
 *
 * Where they stood for election comes first, as it does in the search
 * suggestions: that is the town they asked to represent. A place reached both
 * ways keeps both kinds rather than appearing twice - a councillor employed by
 * their own gmina is the ordinary case, not an oddity.
 *
 * Two places are the same when they carry the same TERYT code, or when they are
 * spelled the same and at least one of them has no code to go on - an election
 * records a gmina by code, a company's seat is whichever region owns it, and
 * neither is guaranteed to carry one.
 */
export function personLocations(
  elections: { location?: string; teryt?: string }[],
  workRegions: PlaceRegion[],
): PersonLocation[] {
  const locations: PersonLocation[] = [];
  const byTeryt = new Map<string, PersonLocation>();
  const byName = new Map<string, PersonLocation>();

  const add = (
    name: string | undefined,
    teryt: string | undefined,
    kind: PersonLocationKind,
  ) => {
    if (!name) return;
    const nameKey = name.toLocaleLowerCase("pl");

    // Two codes that differ are two places, however alike they read - there are
    // several Nowe Wsie. A name only stands in for a code where one side has
    // none, which is what lets an election in Gdańsk and an employer seated
    // there be the one place.
    let seen = teryt ? byTeryt.get(teryt) : undefined;
    if (!seen) {
      const named = byName.get(nameKey);
      if (named && (!named.teryt || !teryt)) seen = named;
    }

    if (seen) {
      if (!seen.kinds.includes(kind)) seen.kinds.push(kind);
      if (!seen.teryt && teryt) {
        seen.teryt = teryt;
        byTeryt.set(teryt, seen);
      }
      return;
    }

    const location: PersonLocation = { name, teryt, kinds: [kind] };
    if (teryt) byTeryt.set(teryt, location);
    if (!byName.has(nameKey)) byName.set(nameKey, location);
    locations.push(location);
  };

  for (const election of elections) {
    add(election.location, election.teryt, "election");
  }
  for (const region of workRegions) add(region.name, region.teryt, "work");

  return locations;
}

/** The places that colour a given powiat on the map.
 *
 * A województwo covers every powiat inside it, so a company owned by one lights
 * up its whole area - which is the truth of what we know about the seat, no
 * more precise than that.
 */
export function locationsCovering(
  locations: PersonLocation[],
  powiat: string,
): PersonLocation[] {
  return locations.filter(
    (location) => location.teryt && terytCoversPowiat(location.teryt, powiat),
  );
}

/** Which kinds a set of places stands for, in the order the legend lists. */
export function locationKinds(
  locations: PersonLocation[],
): PersonLocationKind[] {
  const kinds: PersonLocationKind[] = [];
  for (const kind of ["election", "work"] as const) {
    if (locations.some((location) => location.kinds.includes(kind))) {
      kinds.push(kind);
    }
  }
  return kinds;
}

/** The places we know of but cannot draw - no TERYT code ever reached them. */
export function unplaceableLocations(
  locations: PersonLocation[],
): PersonLocation[] {
  return locations.filter((location) => !location.teryt);
}
