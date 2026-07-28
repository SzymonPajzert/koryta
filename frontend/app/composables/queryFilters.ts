import { computed, type WritableComputedRef } from "vue";
import { useRoute, useRouter, type LocationQuery } from "vue-router";

/** What a filter writes into the url. Empty values drop the key instead. */
type QueryValue = string | string[] | null | undefined;

export type QueryPatch = Record<string, QueryValue>;

/** Query values arrive as a string, an array of them, or null. */
function readAll(value: LocationQuery[string] | undefined): string[] {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.filter((v): v is string => v != null);
}

function isEmpty(value: QueryValue): boolean {
  if (value == null || value === "") return true;
  return Array.isArray(value) && value.length === 0;
}

export function sameQuery(a: LocationQuery, b: LocationQuery): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = readAll(a[key]);
    const right = readAll(b[key]);
    if (left.length !== right.length) return false;
    if (left.some((value, index) => value !== right[index])) return false;
  }
  return true;
}

/** Reads and writes the filters a page keeps in its query string.
 *
 * Every write goes through `setQuery`, which
 *
 * - drops a key rather than writing an empty value, so an unset filter leaves
 *   no trace in the url and a default never has to be spelled out;
 * - does nothing when the result would equal the current query, so arriving on
 *   a page cannot rewrite its own url - that used to add a history entry the
 *   back button had to walk back through;
 * - refuses to write once the user has left the page.
 *
 * That last one matters because a write can be triggered long after the code
 * that scheduled it: a table emits its options when its rows finally arrive, a
 * select drops a value when its items load, a handler resumes after an await.
 * A router location without a `path` resolves against whatever route is
 * current by the time it runs, so a late write would push this page's filters
 * onto the page the user moved to.
 *
 * `resetOnChange` names the parameters a filter change invalidates - paging,
 * in practice - which are dropped whenever a filter is set.
 */
export function useQueryFilters(options: { resetOnChange?: string[] } = {}) {
  const route = useRoute();
  const router = useRouter();

  // The route name, not the path, so a page that owns a route parameter (the
  // visualisation type on /eksploruj/autograf/[type]) still recognises itself
  // after changing it.
  const owner = route.name ?? route.path;

  function setQuery(
    patch: QueryPatch,
    opts: { replace?: boolean; reset?: boolean } = {},
  ): Promise<unknown> | undefined {
    if ((route.name ?? route.path) !== owner) return;

    const dropped = new Set(opts.reset ? (options.resetOnChange ?? []) : []);
    for (const [key, value] of Object.entries(patch)) {
      if (isEmpty(value)) dropped.add(key);
    }

    const query: LocationQuery = Object.fromEntries([
      ...Object.entries(route.query).filter(([key]) => !dropped.has(key)),
      ...Object.entries(patch).filter(([key]) => !dropped.has(key)),
    ]) as LocationQuery;

    if (sameQuery(route.query, query)) return;

    return opts.replace ? router.replace({ query }) : router.push({ query });
  }

  /** A single valued filter, absent from the url when unset. */
  function stringFilter(key: string): WritableComputedRef<string | null> {
    return computed({
      get: () => readAll(route.query[key])[0] ?? null,
      set: (value) => void setQuery({ [key]: value }, { reset: true }),
    });
  }

  /** A repeatable filter, absent from the url when empty. */
  function arrayFilter(key: string): WritableComputedRef<string[] | null> {
    return computed({
      get: () => {
        const values = [...new Set(readAll(route.query[key]))];
        return values.length > 0 ? values : null;
      },
      set: (value) => void setQuery({ [key]: value }, { reset: true }),
    });
  }

  /** A filter picked from a fixed set, whose default stays out of the url. */
  function choiceFilter<T extends string>(
    key: string,
    fallback: T,
  ): WritableComputedRef<T> {
    return computed({
      get: () => (readAll(route.query[key])[0] as T | undefined) ?? fallback,
      set: (value) =>
        void setQuery(
          { [key]: value === fallback ? undefined : value },
          { reset: true },
        ),
    });
  }

  /** A numeric filter, absent from the url when unset or unparseable. */
  function numberFilter(key: string): WritableComputedRef<number | null> {
    return computed({
      get: () => {
        const raw = readAll(route.query[key])[0];
        if (raw == null) return null;
        const parsed = Number.parseInt(raw, 10);
        return Number.isNaN(parsed) ? null : parsed;
      },
      set: (value) =>
        void setQuery(
          { [key]: value == null ? undefined : String(value) },
          { reset: true },
        ),
    });
  }

  return {
    setQuery,
    stringFilter,
    arrayFilter,
    choiceFilter,
    numberFilter,
  };
}
