import type { Node } from "./model";
import type { Person, Company, Region } from "@/../shared/model";

export function personNode(
  person: Person,
  partyColors: Record<string, string>,
): Node {
  const party =
    person.parties && person.parties.length > 0
      ? (person.parties[0] ?? "")
      : "";
  const color = (party != "" ? partyColors[party] : "#4466cc") as Node["color"];
  return {
    ...person,
    type: "circle",
    color: color,
    visibility: person.visibility,
  };
}

export function companyNode(company: Company): Node {
  return {
    ...company,
    type: "rect",
    color: "gray",
    visibility: company.visibility,
  };
}

export function regionNode(region: Region): Node {
  return {
    ...region,
    type: "document",
    color: "green",
    visibility: region.visibility,
  };
}
