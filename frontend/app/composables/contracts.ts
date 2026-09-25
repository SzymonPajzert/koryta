import type { MaybeRefOrGetter, Ref } from "vue";
import { useCurrentUser } from "vuefire";
import { authFetch, authRequest } from "~/composables/auth";
import type {
  ContractCompanyStats,
  ContractCoverage,
  ContractPersonRow,
  ContractRow,
} from "~~/shared/contracts";

/** Every request the contracts feature makes, in one place.
 *
 * Four surfaces read these routes - `/eksploruj/umowy`, the „Umowy publiczne" section on
 * an institution page, the expanded row, and `/eksploruj/umowy` - and three of
 * them take the same `sort`/`zakres`/`nodeId`/`rola` quartet. Hand-built query
 * strings at four call sites is how `zakres=nasze` and `zakres=Nasze` end up
 * being two cache keys for one answer, so every one of them is built here.
 *
 * The split between `use…` and `fetch…` below is not stylistic. `useFetch`
 * registers async data at setup time and keys it; calling one from a click
 * handler aborts whatever else holds that key and leaves the caller awaiting a
 * promise that never settles (see `authRequest`'s docstring). So the first page
 * of a list - which has to be server rendered - is a `use…`, and „Pokaż
 * więcej" and „Szczegóły umowy" - which are clicks - are `fetch…`.
 */

// The three unions below are declared again in `server/utils/contracts.ts`,
// where zod needs them as tuples. That is duplication with a reason and not an
// oversight: `server/utils/contracts.ts` imports firebase-admin, so a client
// module that imported it for three string literals would pull the admin SDK
// into the browser bundle. They belong in `shared/contracts.ts`, which both
// sides may import - moving them is one commit and touches neither handler.

/** Newest first, or largest first. The register's own window is six weeks, so
 * „largest" is a leaderboard and „newest" is a feed; the public page defaults
 * to the feed. */
export type ContractSort = "data" | "kwota";
/** The whole register, the contracts with one end on a company we describe, or
 * the ones with both. */
export type ContractScope = "wszystkie" | "nasze" | "obie";
/** Which side of the contract a company is on, on the surfaces that ask about
 * one company. */
export type ContractRole = "all" | "zamawiajacy" | "wykonawca";

export const CONTRACTS_ENDPOINT = "/api/contracts";

/** A page of the public list. Twenty rows is what `/api/contracts` caps its
 * own default at, and what one „Pokaż więcej" adds. */
export const CONTRACT_PAGE_SIZE = 20;

/** How many rows the company section shows before „Pokaż wszystkie umowy". Five
 * because the sentence above them - „Pięć największych to 81% tej kwoty" - is
 * computed from exactly these rows. */
export const COMPANY_PAGE_SIZE = 5;

/** The query parameter an expanded row writes itself into.
 *
 * Shared with the page so that both agree on the spelling: the row adds it and
 * the page drops it whenever a filter changes. It is never canonical - `/eksploruj/umowy`
 * advertises itself bare whatever this says - so it is a citable link rather
 * than a crawl target.
 */
export const CONTRACT_PARAM = "umowa";

export interface ContractQuery {
  sort?: ContractSort;
  zakres?: ContractScope;
  /** One company's contracts, either end. */
  nodeId?: string;
  rola?: ContractRole;
  limit?: number;
  /** `${sortValue}|${docId}`, opaque here. Never put in the url: it would make
   * a shared link point at page four of an ordering that has since moved. */
  cursor?: string;
}

export interface ContractListResponse {
  rows: ContractRow[];
  nextCursor: string | null;
  /** Only on the first page of an unfiltered-by-company request. Every count
   * and both dates on the page come from it, so a request that does not carry
   * one must not print a figure at all rather than falling back to a literal. */
  coverage: ContractCoverage | null;
}

export interface ContractDetailResponse {
  contract: ContractRow;
  coverage: ContractCoverage | null;
}

export interface ContractCompanyResponse {
  /** Null for the 4 103 of 4 928 companies with no contracts, after exactly one
   * Firestore read. The section renders nothing at all in that case. */
  stats: ContractCompanyStats | null;
  rows: ContractRow[];
  nextCursor: string | null;
  /** Recomputed per request from the rows being served, so the sentence can
   * never assert a share the cards under it contradict. Null below n=10. */
  topFiveShare: number | null;
  hiddenPeople: number;
  coverage: ContractCoverage | null;
}

export interface ContractPeopleResponse {
  people: ContractPersonRow[];
  /** `mode: "obie"` answers with contracts rather than people. */
  rows?: ContractRow[];
  total: number;
  hiddenTotal: number;
  companies: number;
  /** How many institutions the window covers, which is smaller than
   * `companies`. Printed, not hidden: the totals are register-wide and the rows
   * are window-wide. */
  windowSize: number;
  /** Contracts held by the institutions in this window, so the page can say
   * what its rows are drawn from rather than a register-wide figure. */
  windowContracts: number;
  nextCursor: string | null;
  coverage: ContractCoverage | null;
}

/** The query as the endpoint takes it, with every default left out.
 *
 * Dropping defaults rather than spelling them out is what keeps the six filter
 * combinations of `/eksploruj/umowy` to six cache entries: `?sort=data` and no `sort` at
 * all are the same answer, and behind a CDN this repo cannot purge, two
 * spellings of one answer is two copies going stale independently.
 */
function contractQueryParams(query: ContractQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.sort && query.sort !== "data") params.sort = query.sort;
  if (query.zakres && query.zakres !== "wszystkie")
    params.zakres = query.zakres;
  if (query.nodeId) params.nodeId = query.nodeId;
  if (query.rola && query.rola !== "all") params.rola = query.rola;
  if (query.limit !== undefined) params.limit = String(query.limit);
  if (query.cursor) params.cursor = query.cursor;
  return params;
}

/** Which reader an answer was fetched for, as part of the async-data key.
 *
 * `useFetch` hydrates from the server's payload whenever the key matches, and
 * the server renders with no session - so on the three routes that carry people
 * a signed-in reader would keep the anonymous answer, which is precisely the
 * one with the names withheld. Firebase restores the session a tick after
 * hydration; the key changes with it, and a changed key is a refetch.
 *
 * Not `?latest=true`, which `authFetch` also adds: that is an unauthenticated
 * query parameter and it is verified live to return 13 unpublished people by
 * name on `/api/graph/local`. It selects a cache key, it does not prove
 * anything. The gate is `event.context.hasUser`, server side.
 */
export function readerKey(user: Ref<unknown>): string {
  return user.value ? "auth" : "anon";
}

/**
 * The first page of a contract list, server rendered.
 *
 * The key is derived from the query rather than left to the call site, so that
 * the page and the feed inside it - which want different halves of the same
 * response, the coverage figures and the rows - share one async-data entry and
 * therefore one request. Two components on one key is only safe because the
 * options are identical by construction: both build them from the same query
 * through `contractQueryParams`.
 *
 * Plain `useFetch` and not `authFetch`: `/api/contracts` attaches no person
 * data to anybody, which is what lets a signed-in editor and a crawler share a
 * cache entry and keeps a page of 20 rows at ~21 reads on the most crawled
 * surface on the site.
 */
export function useContractList(query: MaybeRefOrGetter<ContractQuery>) {
  const params = computed(() => contractQueryParams(toValue(query)));
  return useFetch<ContractListResponse>(CONTRACTS_ENDPOINT, {
    query: params,
    key: computed(
      () => `contracts:${new URLSearchParams(params.value).toString()}`,
    ),
  });
}

/**
 * A later page, for „Pokaż więcej".
 *
 * `$fetch` rather than the composable above, because a click cannot call a
 * `useFetch`. Nothing is lost by it: the route serves the same rows to
 * everybody, so there is no token to attach and no reader to key on.
 */
export function fetchContractPage(
  query: ContractQuery,
): Promise<ContractListResponse> {
  return $fetch<ContractListResponse>(CONTRACTS_ENDPOINT, {
    query: contractQueryParams(query),
  });
}

/**
 * One contract with the people this reader may see, for „Szczegóły umowy".
 *
 * Through `authRequest`, so the reader's token reaches the handler and the gate
 * has something to verify. A click, so not a `useFetch` - and the answer is
 * cached by the row that asked for it, because the same row expanded twice is
 * the same contract.
 */
export function fetchContractDetail(
  id: string,
): Promise<ContractDetailResponse> {
  return authRequest<ContractDetailResponse>(
    `${CONTRACTS_ENDPOINT}/${encodeURIComponent(id)}`,
    { method: "GET" },
  );
}

/**
 * One company's contracts and what they add up to, for the „Umowy publiczne"
 * section of an institution page.
 */
export function useContractCompany(
  nodeId: MaybeRefOrGetter<string>,
  options: {
    rola?: MaybeRefOrGetter<ContractRole>;
    limit?: number;
  } = {},
) {
  const user = useCurrentUser();
  const params = computed(() => {
    const rola = toValue(options.rola);
    return contractQueryParams({ rola, limit: options.limit });
  });
  return authFetch<ContractCompanyResponse>(
    () =>
      `${CONTRACTS_ENDPOINT}/company/${encodeURIComponent(toValue(nodeId))}`,
    {
      query: params,
      key: computed(
        () =>
          `contracts-company:${toValue(nodeId)}:${readerKey(user)}:` +
          new URLSearchParams(params.value).toString(),
      ),
    },
  );
}

/** What `/eksploruj/umowy` asks for. `mode` decides whether the answer is
 * people or contracts, which is why the response type carries both. */
export interface ContractPeopleQuery {
  mode?: "ludzie" | "obie";
  sort?: "umowy" | "suma" | "ostatnia";
  stan?: "all" | "opublikowane" | "nasze";
  cursor?: string;
}

/**
 * The signed-in, people-oriented view of the same contracts.
 *
 * Answers a logged out reader with counts and nothing else - the gate is the
 * verified token on the server, not this composable.
 *
 * **Nothing calls this today, and that is deliberate rather than an oversight.**
 * `/eksploruj/umowy` loads those rows with `authRequest` from a watcher
 * instead, because a `useFetch` fires at registration and cannot be held back:
 * one here would run the 30-institution, roughly 500-read people query for
 * every signed-in reader sitting on the public contract list, which is now that
 * page's default mode and most of its traffic. It would also make SSR await a
 * request whose output lives inside `<ClientOnly>`.
 *
 * Kept rather than deleted because the shape is right and the query-parameter
 * defaults below are the ones the endpoint validates against; what it needs
 * before it can be used again is an `immediate: false` plus an `execute()` the
 * caller drives. Delete it instead if that day does not come.
 */
export function useContractPeople(
  query: MaybeRefOrGetter<ContractPeopleQuery> = {},
) {
  const user = useCurrentUser();
  const params = computed(() => {
    const value = toValue(query);
    const p: Record<string, string> = {};
    if (value.mode && value.mode !== "ludzie") p.mode = value.mode;
    if (value.sort && value.sort !== "umowy") p.sort = value.sort;
    if (value.stan && value.stan !== "all") p.stan = value.stan;
    if (value.cursor) p.cursor = value.cursor;
    return p;
  });
  return authFetch<ContractPeopleResponse>(`${CONTRACTS_ENDPOINT}/people`, {
    query: params,
    key: computed(
      () =>
        `contracts-people:${readerKey(user)}:` +
        new URLSearchParams(params.value).toString(),
    ),
  });
}
