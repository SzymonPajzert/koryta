import {
  computed,
  onMounted,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";
import type { Router } from "vue-router";
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire";
import { authFetch, authRequest } from "~/composables/auth";
import { readerKey } from "~/composables/contracts";
import { useRenderedUser } from "~/composables/hydrated";
import {
  CONTRACT_LINK_ID_PATTERN,
  contractLinkStrengths,
  type ContractLinkClassFilter,
  type ContractLinkItem,
  type ContractLinkListResponse,
  type ContractLinkSummary,
  type ContractLinkVisibility,
} from "~~/shared/contractLinks";
import type { ContractRow } from "~~/shared/contracts";

/** The findings from the contracts register, as /eksploruj/umowy reads them.
 * The gate is on the server (`contractLinkItem`); nothing here decides who
 * sees a name. */

export const CONTRACT_LINKS_ENDPOINT = "/api/contracts/powiazania";

export const CONTRACT_LINK_SORTS = ["sila", "kwota"] as const;
export type ContractLinkSort = (typeof CONTRACT_LINK_SORTS)[number];

export const CONTRACT_LINK_STATUS_FILTERS = [
  "wszystkie",
  "sprawdzone",
] as const;
export type ContractLinkStatusFilter =
  (typeof CONTRACT_LINK_STATUS_FILTERS)[number];

/** `?powiazanie=<id>`: one finding, pinned above the list. */
export const CONTRACT_LINK_PARAM = "powiazanie";

/** The sixteen, spelled as the pipeline writes `place.wojewodztwo`. A value
 * outside this list can only be a typo, and sent on it is a 400 that the page
 * used to print as „nothing matches". */
export const WOJEWODZTWA = [
  "dolnośląskie",
  "kujawsko-pomorskie",
  "lubelskie",
  "lubuskie",
  "łódzkie",
  "małopolskie",
  "mazowieckie",
  "opolskie",
  "podkarpackie",
  "podlaskie",
  "pomorskie",
  "śląskie",
  "świętokrzyskie",
  "warmińsko-mazurskie",
  "wielkopolskie",
  "zachodniopomorskie",
] as const;

export interface ContractLinksQuery {
  sort?: ContractLinkSort;
  status?: ContractLinkStatusFilter;
  woj?: string;
  klasa?: ContractLinkClassFilter;
  limit?: number;
  cursor?: string;
}

/** The query as the endpoint validates it, defaults left out so that two
 * spellings of one list share one cache entry. */
export function contractLinksParams(
  query: ContractLinksQuery,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.sort && query.sort !== "sila") params.sort = query.sort;
  if (query.status && query.status !== "wszystkie")
    params.status = query.status;
  if (query.woj) params.woj = query.woj;
  if (query.klasa) params.klasa = query.klasa;
  if (query.limit) params.limit = String(query.limit);
  if (query.cursor) params.cursor = query.cursor;
  return params;
}

// --- what the url may say ----------------------------------------------------
// A link is typed by hand, pasted from a chat, or cut short, and every one of
// these used to reach the API verbatim: „?woj=Podlaskie" was a 400, and the page
// printed „Żadne powiązanie nie pasuje" with a dash for the headline.

/** `value` when it is one of `allowed`, otherwise `fallback`. */
export function oneOf<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as T)
    : fallback;
}

/** „Podlaskie", „ podlaskie " and a decomposed „śląskie" all mean one
 * województwo; anything that is not one of the sixteen means none. */
export function normaliseWojewodztwo(
  value: string | null | undefined,
): string | null {
  const cleaned = value?.normalize("NFC").trim().toLocaleLowerCase("pl-PL");
  return cleaned && (WOJEWODZTWA as readonly string[]).includes(cleaned)
    ? cleaned
    : null;
}

/** „a" or „A"; anything else is no class filter. */
export function normaliseClass(
  value: string | null | undefined,
): ContractLinkClassFilter | null {
  const cleaned = value?.trim().toUpperCase() ?? "";
  return (contractLinkStrengths as readonly string[]).includes(cleaned)
    ? (cleaned as ContractLinkClassFilter)
    : null;
}

/** A `?powiazanie=` worth asking the server about. */
export function contractLinkPermalinkId(
  value: string | null | undefined,
): string | null {
  const cleaned = value?.trim() ?? "";
  return CONTRACT_LINK_ID_PATTERN.test(cleaned) ? cleaned : null;
}

// --- what the summary can say about a filtered list --------------------------

/** How many findings the filtered list holds, where the summary knows it - one
 * filter at most, since the summary is precomputed per dimension and not per
 * combination. Null means „not known", never „none". */
export function contractLinkMatchCount(
  summary: ContractLinkSummary | null,
  filters: {
    status: ContractLinkStatusFilter;
    woj: string | null;
    klasa: ContractLinkClassFilter | null;
  },
): number | null {
  if (!summary) return null;
  const verifiedOnly = filters.status === "sprawdzone";
  const active = [verifiedOnly, !!filters.woj, !!filters.klasa].filter(Boolean);
  if (active.length > 1) return null;
  if (verifiedOnly) return summary.verified;
  if (filters.woj) return summary.byWojewodztwo[filters.woj]?.links ?? null;
  if (filters.klasa) return summary.byStrength[filters.klasa];
  return summary.links;
}

/** PLN behind the A-C findings - the ones where the person holds the office
 * now or won it from 2010 on. */
export function contractLinkStrongTotal(summary: ContractLinkSummary): number {
  const { A, B, C } = summary.totalByStrength;
  return A + B + C;
}

/** PLN behind the weaker D findings. */
export function contractLinkWeakTotal(summary: ContractLinkSummary): number {
  return summary.totalByStrength.D;
}

/** Whether most of the gated money is provably in class D.
 *
 * The summary has no per-class split of the gated money, but it has enough for
 * a floor: every złoty of D that is not public is gated, so D minus everything
 * public is the least of it that sits behind the login. The ask only says
 * „mostly weaker links" when that floor is over half - a sentence it can prove
 * with any data, rather than one that is true of today's export. */
export function contractLinkGatedMostlyWeak(
  summary: ContractLinkSummary,
): boolean {
  const gated = summary.totalGated;
  if (gated <= 0) return false;
  const publicTotal = summary.total - gated;
  return (contractLinkWeakTotal(summary) - publicTotal) * 2 > gated;
}

// --- loading -----------------------------------------------------------------

/**
 * The first page, server rendered for the anonymous reader the server always
 * is, and fetched again once firebase restores a session - the reader is part
 * of the key (`readerKey`), and a changed key is a refetch. A signed-in reader
 * would otherwise keep the anonymous answer, which is the one with the gated
 * findings as teasers.
 *
 * The reader in the key is `useRenderedUser`'s, nobody until hydration is
 * over: a session firebase restored first would otherwise pick the `auth` key
 * during hydration, which the server's payload does not hold, and the list
 * would hydrate empty over the server's cards.
 */
export function useContractLinks(query: MaybeRefOrGetter<ContractLinksQuery>) {
  const user = useRenderedUser();
  const params = computed(() => contractLinksParams(toValue(query)));
  return authFetch<ContractLinkListResponse>(CONTRACT_LINKS_ENDPOINT, {
    query: params,
    key: computed(
      () =>
        `contract-links:${readerKey(user)}:` +
        new URLSearchParams(params.value).toString(),
    ),
  });
}

/** What „Pokaż kolejne" has loaded for one list, kept for the rest of the
 * visit. */
interface LoadedPages {
  /** The first page as it was when the reader asked for the second, so a
   * return by Back has something to draw before the refetch lands - without
   * it the page is one screen tall when the router restores the scroll. */
  first: ContractLinkItem[];
  more: ContractLinkItem[];
  cursor: string | null;
}

/**
 * The list as the reader has paged it: the first page (`useContractLinks`)
 * and everything „Pokaż kolejne" appended.
 *
 * The appended pages live in `useState`, keyed by the reader and the query
 * rather than reset by a watcher, which buys two things. A new filter or a
 * reader who has just signed in is a new key and so a fresh list, with no
 * reset to forget; and the same key comes back after Back, so a reader who
 * paged to finding 48, opened a contract and returned finds 48 findings
 * rather than 24.
 */
export function useContractLinkPages(
  query: MaybeRefOrGetter<ContractLinksQuery>,
) {
  const user = useRenderedUser();
  const first = useContractLinks(query);
  const memoryKey = computed(
    () =>
      `${readerKey(user)}:` +
      new URLSearchParams(contractLinksParams(toValue(query))).toString(),
  );
  const memories = useState<Record<string, LoadedPages>>(
    "contract-link-pages",
    () => ({}),
  );
  const memory = computed(() => memories.value[memoryKey.value]);

  const items = computed<ContractLinkItem[]>(() => {
    const head = first.data.value?.items ?? memory.value?.first ?? [];
    const tail = memory.value?.more ?? [];
    // A first page refetched after Back may have moved by a row; the same
    // finding twice would be two cards with one id.
    const seen = new Set(head.map((item) => item.id));
    return [...head, ...tail.filter((item) => !seen.has(item.id))];
  });

  const nextCursor = computed(() =>
    memory.value ? memory.value.cursor : (first.data.value?.nextCursor ?? null),
  );

  const loadingMore = ref(false);
  /** The last „Pokaż kolejne" failed. The button stays, and is the retry. */
  const loadMoreError = ref(false);
  watch(memoryKey, () => {
    loadMoreError.value = false;
  });

  async function loadMore() {
    const cursor = nextCursor.value;
    if (!cursor || loadingMore.value) return;
    const key = memoryKey.value;
    loadingMore.value = true;
    loadMoreError.value = false;
    try {
      const page = await fetchContractLinksPage({
        ...toValue(query),
        cursor,
      });
      const current = memories.value[key];
      memories.value = {
        ...memories.value,
        [key]: {
          first: current?.first ?? first.data.value?.items ?? [],
          more: [...(current?.more ?? []), ...page.items],
          cursor: page.nextCursor,
        },
      };
    } catch (error) {
      // Said beside the button rather than thrown into a click handler, where
      // it reached nobody: the list simply did not grow.
      console.error("Nie udało się wczytać kolejnych powiązań", error);
      if (key === memoryKey.value) loadMoreError.value = true;
    } finally {
      loadingMore.value = false;
    }
  }

  /** Changes one loaded finding in place - the admin's visibility switch -
   * wherever it is held, without refetching and so without dropping the pages
   * the reader has loaded. */
  function patchItem(
    id: string,
    patch: (item: ContractLinkItem) => ContractLinkItem,
  ) {
    const apply = (list: ContractLinkItem[]) =>
      list.map((item) => (item.id === id ? patch(item) : item));
    if (first.data.value) {
      first.data.value = {
        ...first.data.value,
        items: apply(first.data.value.items),
      };
    }
    const key = memoryKey.value;
    const current = memories.value[key];
    if (current) {
      memories.value = {
        ...memories.value,
        [key]: {
          ...current,
          first: apply(current.first),
          more: apply(current.more),
        },
      };
    }
  }

  return {
    ...first,
    items,
    nextCursor,
    loadingMore,
    loadMoreError,
    loadMore,
    patchItem,
  };
}

/** „Pokaż kolejne": a click, so not a `useFetch`, and through `authRequest`
 * so a signed-in reader's token reaches the gate. */
export function fetchContractLinksPage(
  query: ContractLinksQuery,
): Promise<ContractLinkListResponse> {
  return authRequest<ContractLinkListResponse>(CONTRACT_LINKS_ENDPOINT, {
    method: "GET",
    query: contractLinksParams(query),
  });
}

export interface ContractLinkDetailResponse {
  link: ContractLinkItem;
  contracts: ContractRow[];
}

/** One finding and the contracts behind it, for an expanded card. */
export function fetchContractLink(
  id: string,
): Promise<ContractLinkDetailResponse> {
  return authRequest<ContractLinkDetailResponse>(
    `${CONTRACT_LINKS_ENDPOINT}/${encodeURIComponent(id)}`,
    { method: "GET" },
  );
}

/** A permalinked finding: found, or not for this reader. The server answers
 * a gated finding to an anonymous reader with the same 404 as a missing one,
 * and so this cannot tell the two apart either - which is the point. */
export type PinnedContractLink =
  ({ state: "found" } & ContractLinkDetailResponse) | { state: "missing" };

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { statusCode, status } = error as {
    statusCode?: number;
    status?: number;
  };
  return statusCode ?? status;
}

/**
 * `?powiazanie=<id>`, server rendered.
 *
 * `useAsyncData` rather than `authFetch` because there may be no id at all,
 * and a `useFetch` cannot be told to skip. On the server the request goes out
 * without credentials - the server is always the anonymous reader, as it is
 * for the list - and in the browser through `authRequest`, which waits for
 * firebase before it reads the token. The reader is in the key - the rendered
 * one, as for the list - so a session restored after hydration refetches: the
 * teaser becomes the finding.
 */
export function useContractLink(id: MaybeRefOrGetter<string | null>) {
  const user = useRenderedUser();
  return useAsyncData<PinnedContractLink | null>(
    computed(() => `contract-link:${readerKey(user)}:${toValue(id) ?? ""}`),
    async () => {
      const value = toValue(id);
      if (!value) return null;
      const url = `${CONTRACT_LINKS_ENDPOINT}/${encodeURIComponent(value)}`;
      try {
        const answer = import.meta.server
          ? await $fetch<ContractLinkDetailResponse>(url)
          : await fetchContractLink(value);
        return { state: "found", ...answer };
      } catch (error) {
        const status = statusOf(error);
        if (status === 404 || status === 400) return { state: "missing" };
        throw error;
      }
    },
  );
}

/** Admin only, enforced by the route: name a finding publicly, or gate it. */
export function setContractLinkVisibility(
  id: string,
  visibility: ContractLinkVisibility,
): Promise<{ id: string; visibility: ContractLinkVisibility }> {
  return authRequest(`${CONTRACT_LINKS_ENDPOINT}/widocznosc`, {
    body: { id, visibility },
  });
}

// --- the reader who is about to turn out signed in ---------------------------

const SESSION_HINT_KEY = "koryta:zalogowany";

/**
 * True while firebase is still restoring a session that this browser had last
 * time - the window in which a signed-in reader used to be shown the
 * anonymous page: „Załóż konto" in the hero, teasers in the list, the lock on
 * the mode chip, and then all of it swapped out 2-4 s later.
 *
 * The server cannot know (there is no session cookie, see `umowy.vue`), and
 * the first client render has to match the server's, so this is false until
 * mount and only then reads the hint. The hint is ours, in localStorage,
 * written whenever firebase settles here: a reader who was signed in on their
 * last visit gets a neutral placeholder instead of the anonymous asks; a
 * reader who was not - most of them - sees no difference at all.
 */
export function useLikelyReader() {
  const user = useCurrentUser();
  const authReady = useIsCurrentUserLoaded();
  const hint = ref(false);

  onMounted(() => {
    try {
      hint.value = localStorage.getItem(SESSION_HINT_KEY) === "1";
    } catch {
      // Storage refused (private mode, a blocked origin): no hint, and the
      // page behaves as it did before there was one.
    }
  });

  if (import.meta.client) {
    watch(
      user,
      (value) => {
        if (value === undefined) return;
        try {
          if (value) localStorage.setItem(SESSION_HINT_KEY, "1");
          else localStorage.removeItem(SESSION_HINT_KEY);
        } catch {
          // As above.
        }
      },
      { immediate: true },
    );
  }

  return computed(() => hint.value && !authReady.value);
}

// --- counting an ask once per page view ---------------------------------------

/** What has been counted, per router: one per app, and so one per request on
 * the server, where nothing counts anyway. */
const countedPerRouter = new WeakMap<Router, Set<string>>();

/**
 * `claim(name)` is true the first time `name` is claimed in a page view, and
 * false after that until the reader moves to another path.
 *
 * A page view as Plausible counts one: it records a pageview when the
 * pathname changes and not when the query does, so switching /eksploruj/umowy
 * between its modes is one page view. A guard kept on the component instead
 * counted the hero's ask again every time the reader came back to
 * „Powiązania" - the mode switch remounts it - and inflated the denominator
 * `powiazania:gate-click` is read against.
 */
export function usePageViewOnce(): (name: string) => boolean {
  const router = useRouter();
  let counted = countedPerRouter.get(router);
  if (!counted) {
    const names = new Set<string>();
    router.afterEach((to, from, failure) => {
      if (!failure && to.path !== from.path) names.clear();
    });
    countedPerRouter.set(router, names);
    counted = names;
  }
  const names = counted;
  return (name) => {
    if (names.has(name)) return false;
    names.add(name);
    return true;
  };
}
