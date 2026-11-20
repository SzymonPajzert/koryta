/**
 * What asset declarations say about an employment edge: `Edge.declared`, one
 * entry per row readers agreed on, and `Edge.as_of` on an edge a declaration
 * created.
 *
 * Both belong to the edge document rather than to any revision (INTERNAL_FIELDS
 * in server/utils/revisions.ts). And an entry holds more than a page may read
 * (who settled it, how many readers agreed, later the income), so whatever
 * hands an edge out says which part goes.
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
