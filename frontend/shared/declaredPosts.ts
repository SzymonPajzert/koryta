/**
 * What asset declarations say about an employment edge: `Edge.declared`, one
 * entry per row readers agreed on, and `Edge.as_of` on an edge a declaration
 * created.
 *
 * Both belong to the edge document rather than to any revision (INTERNAL_FIELDS
 * in server/utils/revisions.ts), so whatever retires a copy of a post carries
 * them onto the copy that stays itself: a merge that collapses two copies, or
 * a dedupe that deletes one. And an entry holds more than a page may read (who
 * settled it, how many readers agreed, later the income), so whatever hands an
 * edge out says which part goes.
 */
import type { DeclaredPost } from "./model";

/** The fields of an entry a page reads. The rest stays on the edge document,
 * which no route hands out whole. */
export const PUBLIC_DECLARED_FIELDS = [
  "url",
  "as_of",
  "kind",
  "role",
  "start",
] as const;

export type PublicDeclaredPost = Pick<
  DeclaredPost,
  (typeof PUBLIC_DECLARED_FIELDS)[number]
>;

/** A stored `declared` map, or an empty one for anything else. */
export function declaredEntries(
  declared: unknown,
): Record<string, DeclaredPost> {
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(declared as Record<string, unknown>).filter(
      ([, entry]) => !!entry && typeof entry === "object",
    ),
  ) as Record<string, DeclaredPost>;
}

/** `declared` as a page gets it, each entry cut to `PUBLIC_DECLARED_FIELDS`;
 * undefined for an edge with no entries. */
export function publicDeclared(
  declared: unknown,
): Record<string, PublicDeclaredPost> | undefined {
  const entries = Object.entries(declaredEntries(declared));
  if (!entries.length) return undefined;
  return Object.fromEntries(
    entries.map(([key, entry]) => [
      key,
      Object.fromEntries(
        PUBLIC_DECLARED_FIELDS.filter(
          (field) => entry[field] !== undefined,
        ).map((field) => [field, entry[field]]),
      ) as PublicDeclaredPost,
    ]),
  );
}

/** A stored edge for a route that hands edges out whole: without `declared`,
 * which is what a page must not read all of. */
export function withoutPrivateFields<T extends Record<string, unknown>>(
  edge: T,
): Omit<T, "declared"> {
  const { declared: _declared, ...rest } = edge;
  return rest;
}

/** The day an `as_of` stands for: a bare year is its 31 December. */
export function asOfDay(asOf: string): string {
  return /^\d{4}$/.test(asOf) ? `${asOf}-12-31` : asOf;
}

/** The latest `as_of` among the entries, as written; undefined when none has
 * one. */
export function latestAsOf(
  declared: Record<string, { as_of?: unknown }>,
): string | undefined {
  let latest: string | undefined;
  for (const entry of Object.values(declared)) {
    const asOf = entry.as_of;
    if (typeof asOf !== "string" || !asOf) continue;
    if (latest === undefined || asOfDay(asOf) > asOfDay(latest)) latest = asOf;
  }
  return latest;
}

/** What the edge that stays is written with when a copy of it goes. */
export type DeclaredUnion = {
  declared: Record<string, DeclaredPost>;
  as_of?: string;
};

/** The surviving edge's `declared` and `as_of` once a retired copy's entries
 * join it, or null when the copy brings no entry the survivor lacks.
 *
 * An entry under a key the survivor already holds stays as the survivor has
 * it. `as_of` is worked out again only where the survivor has one: only an
 * edge a declaration created carries it, and a register edge that takes in a
 * declared copy's entries stays a register edge. */
export function unionDeclared(
  survivor: { declared?: unknown; as_of?: unknown },
  retired: { declared?: unknown },
): DeclaredUnion | null {
  const held = declaredEntries(survivor.declared);
  const missing = Object.entries(declaredEntries(retired.declared)).filter(
    ([key]) => !Object.hasOwn(held, key),
  );
  if (!missing.length) return null;

  const declared = { ...held, ...Object.fromEntries(missing) };
  if (typeof survivor.as_of !== "string" || !survivor.as_of) {
    return { declared };
  }
  return { declared, as_of: latestAsOf(declared) ?? survivor.as_of };
}

/** Declared entries that went from one edge to another: every key the
 * retired edge held, whichever of them the survivor already had. */
export type DeclaredMove = { from: string; to: string; keys: string[] };

/** What the edge that stays takes in when `retired` copies of it go: the
 * union of their entries with its own (null when they add none), and the
 * moves, for the reading items whose lists of edges name a copy. */
export function foldDeclared(
  survivor: { id: string; data: { declared?: unknown; as_of?: unknown } },
  retired: readonly { id: string; data: { declared?: unknown } }[],
): { union: DeclaredUnion | null; moves: DeclaredMove[] } {
  let union: DeclaredUnion | null = null;
  const moves: DeclaredMove[] = [];
  for (const copy of retired) {
    const keys = Object.keys(declaredEntries(copy.data.declared));
    if (!keys.length) continue;
    moves.push({ from: copy.id, to: survivor.id, keys });
    union = unionDeclared(union ?? survivor.data, copy.data) ?? union;
  }
  return { union, moves };
}

/** The reading item a key belongs to: the declaration's date page,
 * `<sha256>-p<page>`. */
export function declaredItemOf(key: string): string {
  const at = key.indexOf(":");
  return at === -1 ? key : key.slice(0, at);
}

/** A reading item's list of the edges it wrote to, once `moves` are made:
 * each retired edge replaced by the one that stays, following a chain of
 * moves, and each edge listed once, in the order first listed. */
export function rewriteAppliedEdges(
  edges: readonly string[],
  moves: readonly DeclaredMove[],
): string[] {
  const into = new Map(moves.map((move) => [move.from, move.to]));
  const resolve = (id: string) => {
    const seen = new Set([id]);
    let current = id;
    for (;;) {
      const next = into.get(current);
      if (next === undefined || seen.has(next)) return current;
      seen.add(next);
      current = next;
    }
  };
  return [...new Set(edges.map(resolve))];
}
