import type { Edge, Person, Company, Article, Region } from "./model";

// We take an intersection of these with a special handling of type field, to avoid setting it to never.
type EditableNode = Omit<Person, "type"> &
  Omit<Company, "type"> &
  Omit<Article, "type"> &
  Omit<Region, "type"> & { type: "person" | "place" | "article" | "region" };

export function anyNode(node: Partial<EditableNode>): EditableNode {
  if (!node.type) {
    throw new Error("Node type is required");
  }

  return {
    name: node.name || "",
    type: node.type,
    birthDate: node.birthDate || "",
    krsNumber: node.krsNumber || "",
    parties: node.parties || [],
    content: node.content || "",
    sourceURL: node.sourceURL || "",
    shortName: node.shortName || "",
    wikipedia: node.wikipedia || "",
    rejestrIo: node.rejestrIo || "",
    teryt: node.teryt || "",
  };
}

// TODO sync it with api/edges/create POST
export function anyEdge(edge: Partial<Edge>): Edge {
  if (!edge.type) {
    throw new Error("Edge type is required");
  }

  return {
    name: edge.name || "",
    source: edge.source || "",
    target: edge.target || "",
    type: edge.type,
    content: edge.content || "",
    start_date: edge.start_date || undefined,
    end_date: edge.end_date || undefined,
    references: edge.references || [],
    deleted: edge.deleted || false,
    delete_reason: edge.delete_reason || undefined,
  };
}
