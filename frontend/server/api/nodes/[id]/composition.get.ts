import { getQuery, getRouterParam, type H3Event } from "h3";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import {
  committeeLabel,
  compositionUnit,
  type CompositionExecutive,
  type RegionComposition,
} from "~~/shared/regionComposition";

/** The file as the pipelines write it, keyed by PKW unit. */
type StoredUnit = {
  councils?: {
    office: string;
    seats: number;
    split: { committee: string; parties: string[]; seats: number }[];
  }[];
  executive?: Omit<CompositionExecutive, "label">;
};

let units: Promise<Record<string, StoredUnit> | null> | undefined;

/** Read once per process: it changes only with a deploy. */
function readUnits() {
  units ??= useStorage("assets:server")
    .getItem<Record<string, StoredUnit>>("pkw_local_2024.json")
    .catch(() => null);
  return units;
}

/** PKW's whole 2024 result for one region page: seats per council by
 * committee, and the head's title, committee and declared party. Public
 * numbers, the same for every reader. See shared/regionComposition.ts. */
async function composition(event: H3Event): Promise<RegionComposition | null> {
  const id = getRouterParam(event, "id") ?? "";
  const unit = compositionUnit(id.replace(/^teryt/, ""));
  if (!unit) return null;
  const stored = (await readUnits())?.[unit];
  if (!stored) return null;
  // TEMP(wariant): the names question on the board round; the name is never
  // served otherwise.
  const names = getQuery(event).nazwiska === "1";
  const executive = stored.executive
    ? {
        ...stored.executive,
        label: committeeLabel(
          stored.executive.committee,
          stored.executive.parties,
        ),
        ...(names ? {} : { name: undefined }),
      }
    : null;
  return {
    election: "local-2024",
    unit,
    executive,
    councils: (stored.councils ?? []).map((council) => ({
      office: council.office,
      seats: council.seats,
      split: council.split.map((seats) => ({
        ...seats,
        label: committeeLabel(seats.committee, seats.parties),
      })),
    })),
  };
}

export default authCachedEventHandler(composition, { name: "composition" });
