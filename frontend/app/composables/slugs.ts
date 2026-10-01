import type { NodeType, Node } from "~~/shared/model";

export type SeoType = "osoba" | "instytucja" | "region" | "artykul" | "temat";

export const seoTypes: readonly SeoType[] = [
  "osoba",
  "instytucja",
  "region",
  "artykul",
  "temat",
] as const;

/** The status a slug-healing redirect to `url` goes out with on the server.
 *
 * Every one of these redirects says "the id in this url resolves, but this is
 * not the address its page is at": an `/entity/:type/:id`, a slug from before a
 * rename, a mangled id. Where `url` is the node's own page, that is a permanent
 * move and it says so with a 301. Anywhere else - a region, sent to the table
 * for want of a page of its own - it is a stopgap, and stays a 302.
 *
 * This was a 302 throughout until 2026-10-01, because a browser keeps a 301
 * for the life of the profile: companies were forwarded to `/eksploruj/tabela`
 * between 2026-05-31 and 2026-08-26, and after the page came back an
 * `/instytucja/...` url still went to the table in any browser that had been
 * there before. `redirectToNodeUrl` now sends these with `no-store`, so no
 * browser keeps either kind - and a 301 to a node's own page could not strand
 * anybody anyway, since that address resolves through this same code.
 *
 * What the 302 cost was measured on 2026-10-01, and the sitemap advertising the
 * canonical url did not prevent it. Google treats a 302 as "the page still
 * lives here", so it kept the old address as the page's own: of 64
 * `/entity/` urls inspected, 31 were indexed under that address, 28 of them
 * alongside the readable page - two copies of one page splitting what it ranks
 * on. 62 `/entity/` urls drew 312 impressions in the two weeks to 09-30.
 * Company slugs renamed with their town were the same: 8 of 20 old ones still
 * indexed as themselves.
 */
export function slugRedirectCode(url: string): 301 | 302 {
  return /^\/(osoba|instytucja|region|artykul|temat)\/[^?#]+$/.test(url)
    ? 301
    : 302;
}

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

/** An id reduced to what survives the two ways a link to a page reaches us
 * mangled: lowercased, and with punctuation stuck to its end.
 *
 * The lowercasing was ours. Until 2026-08-08 nuxt-seo-utils lowercased every
 * canonical and og:url the site sent (`canonicalLowercase` in nuxt.config.ts),
 * and a Firestore id is case sensitive, so every page advertised an address
 * that does not resolve. Google filed those addresses as the pages' own and
 * still asks for them, each time naming the real page as where it found the
 * link. The punctuation is everybody else's: a link pasted at the end of a
 * sentence keeps its full stop. */
export function mangledIdKey(id: string): string {
  return id.replace(/[^A-Za-z0-9]+$/, "").toLowerCase();
}

/** Whether `id` could be a mangled copy of another page's id - worth asking
 * only once it has failed to resolve as it is.
 *
 * A generated Firestore id is twenty characters drawn from both cases, so one
 * that has letters and not a single capital has all but certainly lost them:
 * by chance that happens to about one id in 50,000. */
export function mayBeMangledId(id: string): boolean {
  return /[^A-Za-z0-9]$/.test(id) || (/[a-z]/.test(id) && !/[A-Z]/.test(id));
}
