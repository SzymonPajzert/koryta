import type { NodeType, Node } from "~~/shared/model";

export type SeoType = "osoba" | "instytucja" | "region" | "artykul" | "temat";

export const seoTypes: readonly SeoType[] = [
  "osoba",
  "instytucja",
  "region",
  "artykul",
  "temat",
] as const;

/** The status a slug-healing redirect goes out with on the server.
 *
 * 302, deliberately, and not 301. Every one of these redirects says "the id in
 * this url resolves, but the slug in front of it is not the current canonical
 * one" - and what is canonical is derived from the node's name and from which
 * types have a page of their own, both of which change. A 301 is cached by the
 * browser for the life of the profile and is never revalidated, so each such
 * change would be frozen into every browser that saw the old answer, with no
 * deploy able to reach it.
 *
 * That is not hypothetical: companies were forwarded to `/eksploruj/tabela`
 * between 2026-05-31 and 2026-08-26, and after the page came back an
 * `/instytucja/...` url still went to the table in any browser that had been
 * there before - the request never left the machine.
 *
 * The cost is the search-engine signal a 301 carries and a 302 does not. It is
 * worth paying: `_sitemap-urls.ts` advertises the canonical url directly, so a
 * crawler is told the right address without having to be redirected to it.
 */
export const SLUG_REDIRECT_CODE = 302;

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
    case "topic":
      return "temat";
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
    case "temat":
      return "topic";
    default:
      throw new Error(`Unknown slug prefix: ${prefix}`);
  }
}

export function generateEntityUrl(
  type: NodeType,
  id: string,
  name?: string,
): string {
  if (!name) return `/entity/${type}/${id}`;
  const prefix = nodeTypeToSlugPrefix(type);
  const slug = createSlug(name);
  return `/${prefix}/${slug}-${id}`;
}

export function generateNodeUrl(node: Node): string | undefined {
  if (!node.id) return undefined;

  switch (node.type) {
    // The types with a readable page of their own.
    //
    // Person and article are what the sitemap lists, and what somebody shares.
    // A topic is reachable but stays out of the sitemap until the tagging is
    // more than a handful of stories - and so, for now, is a company: putting
    // ~3,979 institution urls back into it is a decision separate from
    // restoring the pages themselves.
    //
    // A company had no page at all between 2026-05-21 and 2026-08-24 and was
    // redirected to the table filtered to it, back when the branch rendering
    // one held only owners and subsidiaries. The table answers "who works
    // here"; it could never answer "who did they replace".
    case "person":
    case "article":
    case "topic":
    case "place":
      return generateEntityUrl(node.type, node.id, node.name);

    case "region": {
      if (node.id == "teryt1261") {
        return "/region/krakow-teryt1261";
      }
      const teryt = node.id.replace("teryt", "");
      return `/eksploruj/tabela?teryt=${teryt}`;
    }

    // A type the front end does not know about yet keeps whatever url it was
    // reached by, rather than being sent somewhere wrong.
    default:
      return undefined;
  }
}

/** Where a link to `node` should point, with `/entity/:type/:id` as the floor.
 *
 * `generateNodeUrl` answers `undefined` for a type the front end has no page
 * for, and a relation card rendering one still has to link somewhere; the
 * `/entity/` url is that somewhere, because `entity-slug` middleware resolves
 * the id and forwards it.
 *
 * The point is that it is the floor and not the default. Relation cards used to
 * build that url unconditionally, from a node whose `name` they were rendering
 * one line further down - so every row on a person's page was a 302 out to the
 * url the sitemap already advertises. Search Console had 2,372 pages parked in
 * "Strona zawiera przekierowanie" on 2026-09-10 and was ranking 13 `/entity/`
 * urls in place of the pages they point at.
 */
export function nodeLinkUrl(node: Node): string {
  return generateNodeUrl(node) ?? `/entity/${node.type}/${node.id}`;
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
