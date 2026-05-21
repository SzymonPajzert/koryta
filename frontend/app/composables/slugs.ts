import type { NodeType, Node } from "~~/shared/model";

export type SeoType = "osoba" | "instytucja" | "region" | "artykul";

export const seoTypes: readonly SeoType[] = [
  "osoba",
  "instytucja",
  "region",
  "artykul",
] as const;

export function createSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // removes diacritics
    .replace(/ł/g, "l")
    .replace(/Ł/g, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric with dash
    .replace(/(^-|-$)+/g, ""); // remove leading/trailing dashes
}

export function nodeTypeToSlugPrefix(type: NodeType): SeoType {
  switch (type) {
    case "person":
      return "osoba";
    case "place":
      return "instytucja";
    case "region":
      return "region";
    case "article":
      return "artykul";
    default:
      return type;
  }
}

export function slugPrefixToNodeType(prefix: SeoType): NodeType {
  switch (prefix) {
    case "osoba":
      return "person";
    case "instytucja":
      return "place";
    case "region":
      return "region";
    case "artykul":
      return "article";
    default:
      throw new Error(`Unknown slug prefix: ${prefix}`);
  }
}

export function generateEntityUrl(
  type: NodeType,
  id: string,
  name?: string,
): string {
  // Hardcoded Kraków here
  if (type == "region" && id != "teryt1261") {
    const teryt = id.replace("teryt", "");
    return `/eksploruj/tabela?teryt=${teryt}`;
  }

  if (!name) return `/entity/${type}/${id}`;
  const prefix = nodeTypeToSlugPrefix(type);
  const slug = createSlug(name);
  return `/${prefix}/${slug}-${id}`;
}

export function generateNodeUrl(node: Node): string | undefined {
  if (!node.id) return undefined;

  if (node.type === "person") {
    return generateEntityUrl(node.type, node.id, node.name);
  }

  if (node.type === "place") {
    return "/eksploruj/tabela?";
  }
}

export function parseEntityUrlSlug(slugWithId: string): {
  slug: string;
  id: string;
} {
  const parts = slugWithId.split("-");
  const id = parts.pop() || "";
  const slug = parts.join("-");
  return { slug, id };
}
