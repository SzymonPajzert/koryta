<template>
  <div class="w-100">
    <h1 class="text-h5 text-sm-h4 mb-1">Rewizje</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Kto i co zmienił we wpisach i powiązaniach — i co z tego wciąż czeka na
      decyzję.
    </p>

    <!-- The two admin sections are gated on `isAdmin`, not on the page's
         middleware: this page is `middleware: "auth"`, so any signed-in reader
         reaches it, while both endpoints behind these sections are admin-only
         and would answer them with a 403. -->
    <section v-if="admin" id="kolejka" class="rev-section mb-8">
      <AdminSectionHead
        :title="status === 'pending' ? 'Czeka na decyzję' : 'Propozycje zmian'"
        :count="queueCount"
        :info="queueScope"
      >
        <v-select
          v-model="status"
          :items="statusOptions"
          label="Status"
          density="compact"
          variant="outlined"
          hide-details
          class="rev-filter"
          data-filter="status"
        />
        <v-select
          v-model="automatic"
          :items="automaticOptions"
          label="Rodzaj"
          density="compact"
          variant="outlined"
          hide-details
          class="rev-filter"
          data-filter="automatic"
        />
        <!-- No dropdown of people: there is no client-side list of uids, and
             the way in is a click from "Najaktywniejsi" on /eksploruj/statystyki
             or from an open row below. -->
        <v-chip
          v-if="author"
          closable
          variant="tonal"
          data-author-filter
          @click:close="author = null"
        >
          <span class="mr-1">Tylko:</span>
          <UserChip :uid="author" />
        </v-chip>
      </AdminSectionHead>

      <!-- The list an admin is looking at is not the whole history, and saying
           so is the difference between a queue and a lie. -->
      <v-alert
        v-if="showsFlagOnlyNotice"
        type="info"
        color="ink-info"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        Ta lista obejmuje propozycje zgłoszone od lipca 2026 — wcześniejsze
        rewizje nie mają zapisanego, czy powstały ręcznie. Pełną historię jednej
        osoby zobaczysz, klikając jej nazwę w „Najaktywniejsi” na
        <NuxtLink to="/eksploruj/statystyki">stronie statystyk</NuxtLink>.
      </v-alert>

      <v-alert
        v-if="queue?.truncated"
        type="warning"
        color="ink-warning"
        variant="tonal"
        density="compact"
        class="mb-3"
        :text="`Wczytaliśmy ${AUTHOR_SCAN_CAP} najnowszych rewizji tej osoby. Starsze są poza tym zestawieniem.`"
      />

      <v-alert
        v-if="queueFailed"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
        text="Nie udało się wczytać kolejki."
      />

      <div v-if="pinned" class="mb-4" data-pinned>
        <p class="d-flex align-center ga-1 text-body-2 mb-1">
          <v-icon :icon="mdiLinkVariant" size="small" class="text-ink-sage" />
          <span class="font-weight-medium">Propozycja z linku</span>
          <span v-if="pinned.status !== 'pending'" class="text-medium-emphasis">
            · Ta propozycja została już rozpatrzona.
          </span>
        </p>
        <AdminRowList>
          <RevisionQueueRow
            :expanded="isOpen(queueKey(pinned.id))"
            :proposal="pinned"
            highlighted
            :loading="deciding === pinned.id"
            :author-focused="!!author"
            @update:expanded="setOpen(queueKey(pinned.id), $event)"
            @approve="approve(pinned!, $event)"
            @reject="openReject(pinned!)"
            @permalink="copyPermalink(pinned!)"
            @focus-author="focusAuthor"
          />
        </AdminRowList>
      </div>

      <v-alert
        v-if="isEmptyDefaultQueue"
        type="success"
        color="ink-success"
        variant="tonal"
        density="compact"
        :icon="mdiCheckDecagramOutline"
        text="Kolejka jest pusta — nic nie czeka na rozpatrzenie."
      />
      <template v-else>
        <v-progress-linear
          v-if="queuePending"
          indeterminate
          color="primary"
          class="mb-1"
        />
        <AdminRowList v-if="queueRows.length > 0" data-queue-list>
          <RevisionQueueRow
            v-for="proposal in queueRows"
            :key="proposal.id"
            :expanded="isOpen(queueKey(proposal.id))"
            :proposal="proposal"
            :loading="deciding === proposal.id"
            :author-focused="!!author"
            @update:expanded="setOpen(queueKey(proposal.id), $event)"
            @approve="approve(proposal, $event)"
            @reject="openReject(proposal)"
            @permalink="copyPermalink(proposal)"
            @focus-author="focusAuthor"
          />
        </AdminRowList>
        <p
          v-else-if="queue && !queuePending"
          class="text-body-2 text-medium-emphasis mb-0"
          data-queue-empty
        >
          {{ queueEmptyText }}
        </p>
        <div
          v-if="queueTotal > SMALLEST_PAGE_SIZE"
          class="rev-pager d-flex flex-wrap align-center ga-2 mt-2"
        >
          <v-pagination
            v-if="queuePages > 1"
            v-model="page"
            :length="queuePages"
            density="compact"
            class="flex-1-1"
          />
          <v-select
            v-model="itemsPerPage"
            :items="PAGE_SIZES"
            label="Na stronę"
            density="compact"
            variant="outlined"
            hide-details
            class="rev-per-page ms-auto"
          />
        </div>
      </template>
    </section>

    <section v-if="admin" id="powiazania" class="rev-section mb-8">
      <!-- No count while a type is picked: the endpoint counts every pending
           edge revision whatever its type, so the number would describe a
           list the reader is not looking at. -->
      <AdminSectionHead
        title="Zmiany powiązań"
        :count="edgeType ? undefined : (edges?.total ?? undefined)"
        info="Zmiany powiązań, których nikt jeszcze nie rozpatrzył - głównie od pipeline'u. Pipeline zapisuje zmianę od razu tylko wtedy, gdy potrafi za nią ręczyć - komitet wyborczy z listy przypisanej do partii. Reszta czeka tutaj, a samo powiązanie pozostaje nietknięte. „Rozpatrz” otwiera zmianę w kolejce wyżej."
      >
        <v-select
          v-model="edgeType"
          :items="edgeTypeOptions"
          label="Typ powiązania"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="rev-filter"
          data-filter="edgeType"
        />
      </AdminSectionHead>

      <v-alert
        v-if="edgesFailed"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
        text="Nie udało się wczytać zmian powiązań."
      />
      <v-progress-linear
        v-if="edgesPending"
        indeterminate
        color="primary"
        class="mb-1"
      />
      <AdminRowList v-if="edgeRows.length > 0" data-edge-list>
        <RevisionEdgeRow
          v-for="revision in edgeRows"
          :key="revision.id"
          :expanded="isOpen(edgeKey(revision.id))"
          :revision="revision"
          :type-labels="edgeTypeLabels"
          @update:expanded="setOpen(edgeKey(revision.id), $event)"
        />
      </AdminRowList>
      <p
        v-else-if="edges && !edgesPending"
        class="text-body-2 text-medium-emphasis mb-0"
      >
        Nic nie czeka na rozpatrzenie.
      </p>
      <v-pagination
        v-if="edgePages > 1"
        v-model="edgePage"
        :length="edgePages"
        density="compact"
        class="mt-2"
      />
    </section>

    <section id="wpisy" class="rev-section">
      <AdminSectionHead
        title="Wpisy z historią zmian"
        :count="nodes?.total"
        info="Każdy wpis, który ktoś zmienił - także pipeline. Rozwiń wiersz, żeby zobaczyć kolejne wersje i kto je zapisał; ikona na końcu wiersza pokazuje wszystkie wersje obok siebie."
      >
        <!-- Phrased by what is left to do rather than by the field name:
             `has_unapproved` says the opposite of "zaakceptowane", so naming
             either one here would read backwards next to the other. -->
        <v-select
          v-model="nodeStatus"
          :items="nodeStatusOptions"
          label="Stan"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="rev-filter rev-filter--wide"
          data-filter="nodeStatus"
        />
        <v-select
          v-model="nodeType"
          :items="nodeTypeOptions"
          label="Typ"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="rev-filter"
          data-filter="nodeType"
        />
        <v-select
          v-model="nodeSort"
          :items="nodeSortOptions"
          label="Sortuj"
          density="compact"
          variant="outlined"
          hide-details
          class="rev-filter rev-filter--wide"
          data-filter="nodeSort"
        />
      </AdminSectionHead>

      <v-alert
        v-if="nodesFailed"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
        text="Nie udało się wczytać wpisów."
      />
      <v-progress-linear
        v-if="nodesPending"
        indeterminate
        color="primary"
        class="mb-1"
      />
      <AdminRowList v-if="nodeRows.length > 0" data-node-list>
        <RevisionNodeRow
          v-for="node in nodeRows"
          :key="node.id"
          :expanded="isOpen(nodeKey(node.id))"
          :node="node"
          :type-label="nodeTypeLabels[node.type] ?? node.type"
          @update:expanded="setOpen(nodeKey(node.id), $event)"
          @changed="onHistoryChanged"
        />
      </AdminRowList>
      <p
        v-else-if="nodes && !nodesPending"
        class="text-body-2 text-medium-emphasis mb-0"
      >
        Żaden wpis nie pasuje do filtrów.
      </p>
      <div
        v-if="(nodes?.total ?? 0) > SMALLEST_PAGE_SIZE"
        class="rev-pager d-flex flex-wrap align-center ga-2 mt-2"
      >
        <v-pagination
          v-if="nodePages > 1"
          v-model="nodePage"
          :length="nodePages"
          density="compact"
          class="flex-1-1"
        />
        <v-select
          v-model="nodePerPage"
          :items="PAGE_SIZES"
          label="Na stronę"
          density="compact"
          variant="outlined"
          hide-details
          class="rev-per-page ms-auto"
        />
      </div>
    </section>

    <RevisionRejectDialog
      v-model="rejectOpen"
      :loading="deciding === rejectTarget?.id"
      :target-name="rejectTarget?.targetName"
      @confirm="reject"
    />

    <v-snackbar v-model="noticeShown" color="success" :timeout="4000">
      {{ notice }}
    </v-snackbar>
    <v-snackbar v-model="errorShown" color="error" :timeout="6000">
      {{ error }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
/** Everything about revisions, on one page, in three sections.
 *
 * - **Czeka na decyzję** (`#kolejka`, admins): one row per proposal, human work
 *   first. What used to be /admin/rewizje/kolejka.
 * - **Zmiany powiązań** (`#powiazania`, admins): pending changes to relations,
 *   mostly the ingest's. What used to be /admin/rewizje-krawedzi, which could
 *   list them but not decide on them - "Rozpatrz" now pins one in the queue.
 * - **Wpisy z historią zmian** (`#wpisy`, every signed-in reader): one row per
 *   entry with its history inside. What used to be the table on this url.
 *
 * They were three pages with three looks for what is one question - what
 * changed, who changed it, and what is still waiting - and the queue and the
 * entry list cannot answer each other's half of it: authorship lives on the
 * revision rather than on the node, and 96% of the revisions in the collection
 * were written by the pipeline, so a volunteer's suggestion was visible on the
 * entry list only as a number with nothing behind it.
 *
 * Every row is one line that opens in place (`AdminExpandRow`), the way the
 * work queue on /admin/opinie reads. Which rows are open is held here rather
 * than in the rows, so a permalink can open one.
 *
 * The queue has two modes, and the difference matters. Without `?author=` the
 * endpoint can only see revisions that carry an explicit `update_automatic`
 * flag, which nothing wrote for a human change before July 2026; with it, it
 * reads one person's revisions whole and filters in memory, so it sees
 * everything they ever proposed. The link out of the contributor table uses the
 * second, which is why that is the click the owner was missing.
 *
 * The old urls redirect here: /admin/rewizje/kolejka keeps its whole query
 * (`status`, `automatic`, `author`, `rewizja`, `page`, `itemsPerPage` are this
 * page's names for the same things) and lands on `#kolejka`, and
 * /admin/rewizje-krawedzi lands on `#powiazania`.
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import type { LocationQuery } from "vue-router";
import { mdiCheckDecagramOutline, mdiLinkVariant } from "@mdi/js";
import { authRequest, useAuthState } from "~/composables/auth";
import { sameQuery } from "~/composables/queryFilters";
import type { RevisedNode } from "~/components/revision/NodeRow.vue";
import type { NodeType } from "~~/shared/model";
import type { Proposal } from "~~/shared/proposals";
import type { RevisionQueue } from "~~/server/api/revisions/queue.get";
import type { PendingEdgeRevision } from "~~/server/api/revisions/pendingEdges.get";

// Narrower than the default 1200: rows are one line each, and a line much
// wider than this leaves the eye tracking it across a monitor.
definePageMeta({
  middleware: "auth",
  maxWidth: 1100,
});

useHead({ title: "Rewizje (Admin) - koryta.pl" });

type SectionId = "kolejka" | "powiazania" | "wpisy";
const SECTIONS: readonly SectionId[] = ["kolejka", "powiazania", "wpisy"];

/** Mirrors `AUTHOR_SCAN_CAP` in `/api/revisions/queue`; the module itself pulls
 * in firebase-admin, so only its type survives into the client bundle. */
const AUTHOR_SCAN_CAP = 500;

/** The page sizes both paged lists offer. `/api/nodes/revisions` takes any
 * `limit` at all, so the url is held to these rather than passed through. */
const PAGE_SIZES = [10, 25, 50, 100];
/** Below this many rows a list has nothing to page through or resize. */
const SMALLEST_PAGE_SIZE = Math.min(...PAGE_SIZES);

/** How many edge revisions one page holds - the endpoint's own default. */
const EDGE_PAGE_SIZE = 25;

const { isAdmin } = useAuthState();
/** `isAdmin` is undefined until the token has been read; only a definite yes
 * shows the admin sections, and only a definite answer either way lets the page
 * decide it has finished loading (see `scrollTarget`). */
const admin = computed(() => isAdmin.value === true);

const route = useRoute();
const router = useRouter();

// ---------------------------------------------------------------------------
// The url

/** The first value of a query key, or null. */
const readQuery = (key: string): string | null => {
  const value = route.query[key];
  return (Array.isArray(value) ? value[0] : value) ?? null;
};

/** Writes filters and paging into the url, and names in its hash the section
 * they belong to.
 *
 * The hash is not decoration. A router location without one drops whatever
 * hash the url had, and Nuxt answers a same-page navigation that loses its hash
 * by scrolling to the top - so the first filter changed on a page opened at
 * `#wpisy` would have thrown the reader back above the queue. With the
 * section's own anchor instead, every change lands on the head of the section
 * that changed, which is where its results start; and a copied url opens
 * there.
 *
 * Empty values drop their key, so a default never has to be spelled out, and
 * `reset` names the paging a change makes meaningless. */
function writeQuery(
  section: SectionId,
  patch: Record<string, string | null | undefined>,
  reset: string[] = [],
) {
  const dropped = new Set(reset);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === "") dropped.add(key);
  }
  const query: LocationQuery = Object.fromEntries([
    ...Object.entries(route.query).filter(([key]) => !dropped.has(key)),
    ...Object.entries(patch).filter(([key]) => !dropped.has(key)),
  ]) as LocationQuery;
  const hash = `#${section}`;
  if (sameQuery(route.query, query) && route.hash === hash) return;
  void router.push({ query, hash });
}

/** A filter picked from a fixed set, whose default stays out of the url.
 *
 * Anything outside the set reads as the default rather than reaching the
 * api, which would reject it: the names are shared with older urls (`status`
 * on this address used to filter the entry list by `unapproved`), and a table
 * that comes back empty with only the console to say why is the worse
 * answer. */
function choiceFilter<T extends string>(
  section: SectionId,
  key: string,
  allowed: readonly T[],
  fallback: T,
  reset: string,
) {
  return computed<T>({
    get: () => {
      const value = readQuery(key) as T | null;
      return value !== null && allowed.includes(value) ? value : fallback;
    },
    set: (value) =>
      writeQuery(section, { [key]: value === fallback ? undefined : value }, [
        reset,
      ]),
  });
}

/** An optional filter from a fixed set; cleared, it leaves the url. */
function optionalFilter<T extends string>(
  section: SectionId,
  key: string,
  allowed: readonly T[],
  reset: string,
) {
  return computed<T | null>({
    get: () => {
      const value = readQuery(key) as T | null;
      return value !== null && allowed.includes(value) ? value : null;
    },
    set: (value) => writeQuery(section, { [key]: value }, [reset]),
  });
}

/** A page number. Paging is not a filter, so it resets nothing. */
function pageParam(section: SectionId, key: string) {
  return computed<number>({
    get: () => {
      const parsed = Number.parseInt(readQuery(key) ?? "", 10);
      return parsed > 1 ? parsed : 1;
    },
    set: (value) =>
      writeQuery(section, { [key]: value > 1 ? String(value) : undefined }),
  });
}

/** A page size, one of `PAGE_SIZES`. A different size makes the current page
 * number meaningless, so it goes too. */
function pageSizeParam(
  section: SectionId,
  key: string,
  pageKey: string,
  fallback: number,
) {
  return computed<number>({
    get: () => {
      const parsed = Number.parseInt(readQuery(key) ?? "", 10);
      return PAGE_SIZES.includes(parsed) ? parsed : fallback;
    },
    set: (value) =>
      writeQuery(
        section,
        { [key]: value === fallback ? undefined : String(value) },
        [pageKey],
      ),
  });
}

// ---------------------------------------------------------------------------
// Which rows are open

/** The open rows, by section and id, so a permalink can open one and the rows
 * stay open across a refetch that brings them back. */
const openRows = reactive(new Set<string>());
const queueKey = (id: string) => `kolejka:${id}`;
const edgeKey = (id: string) => `powiazania:${id}`;
const nodeKey = (id: string) => `wpisy:${id}`;
const isOpen = (key: string) => openRows.has(key);
const setOpen = (key: string, open: boolean) => {
  if (open) openRows.add(key);
  else openRows.delete(key);
};

// ---------------------------------------------------------------------------
// Czeka na decyzję

const status = choiceFilter(
  "kolejka",
  "status",
  ["pending", "approved", "rejected", "all"] as const,
  "pending",
  "page",
);
const automatic = choiceFilter(
  "kolejka",
  "automatic",
  ["false", "true", "all"] as const,
  "false",
  "page",
);
const author = computed<string | null>({
  get: () => readQuery("author"),
  set: (value) => writeQuery("kolejka", { author: value }, ["page"]),
});
/** Not a filter but a selector: it names one proposal to answer with, and the
 * endpoint returns it whether or not the current filters would have. */
const permalinked = computed(() => readQuery("rewizja"));

const page = pageParam("kolejka", "page");
const itemsPerPage = pageSizeParam("kolejka", "itemsPerPage", "page", 25);

const statusOptions = [
  { title: "Oczekujące", value: "pending" },
  { title: "Zatwierdzone", value: "approved" },
  { title: "Odrzucone", value: "rejected" },
  { title: "Wszystkie", value: "all" },
];

const automaticOptions = [
  { title: "Od ludzi", value: "false" },
  { title: "Z pipeline'u", value: "true" },
  { title: "Wszystko", value: "all" },
];

const queue = ref<RevisionQueue | null>(null);
const queuePending = ref(false);
const queueFailed = ref(false);

const queueTotal = computed(() => queue.value?.total ?? 0);
const queuePages = computed(() =>
  Math.ceil(queueTotal.value / itemsPerPage.value),
);
const queueCount = computed(() =>
  queue.value
    ? `${queue.value.total}${queue.value.truncated ? "+" : ""}`
    : undefined,
);

/** The proposal a permalink names, at the top of the section whether or not
 * the page of results holds it too. The endpoint only sends it separately
 * when it is not on the page; when it is, it moves up here rather than being
 * shown twice. */
const pinned = computed<Proposal | null>(() => {
  const id = permalinked.value;
  if (!id || !queue.value) return null;
  return (
    queue.value.pinned ??
    queue.value.revisions.find((row) => row.id === id) ??
    null
  );
});

const queueRows = computed(() =>
  (queue.value?.revisions ?? []).filter((row) => row.id !== pinned.value?.id),
);

const queueQuery = computed(() => ({
  page: page.value,
  limit: itemsPerPage.value,
  status: status.value,
  automatic: automatic.value,
  author: author.value || undefined,
  revision: permalinked.value || undefined,
}));

// Requests can land out of order once a filter and a page change chase each
// other, so only the newest one is allowed to write the list.
let latestQueueRequest = 0;
/** The permalink whose row has been opened for the reader already. */
let openedPermalink: string | null = null;

const loadQueue = async () => {
  // The endpoint only answers a caller carrying an admin token, which the
  // server render has no way to present - it would spend a request on a 401.
  if (import.meta.server || !admin.value) return;

  const request = ++latestQueueRequest;
  queuePending.value = true;
  queueFailed.value = false;
  try {
    const response = await authRequest<RevisionQueue>("/api/revisions/queue", {
      method: "GET",
      query: queueQuery.value,
    });
    if (request !== latestQueueRequest) return;
    queue.value = response;
    // Opened once per permalink, not on every reload: a reviewer who closed
    // it and then changed a filter meant to close it.
    const id = permalinked.value;
    if (id && id !== openedPermalink && pinned.value?.id === id) {
      openedPermalink = id;
      setOpen(queueKey(id), true);
    }
  } catch (err) {
    if (request !== latestQueueRequest) return;
    console.error("Failed to load the review queue", err);
    queue.value = null;
    queueFailed.value = true;
  } finally {
    if (request === latestQueueRequest) {
      queuePending.value = false;
      void scrollWhenLoaded();
    }
  }
};

// The parameters one by one rather than `queueQuery`: that object is rebuilt on
// every change to the url, the other sections' paging included, and the queue
// would be read again each time.
watch(
  [page, itemsPerPage, status, automatic, author, permalinked, admin],
  loadQueue,
  { immediate: true },
);

/** The aggregate list cannot see revisions written before the flag existed, and
 * a reader has no way to tell that from a quiet week. Only said where it is
 * true: the per-author mode has no such gap. */
const showsFlagOnlyNotice = computed(
  () =>
    !author.value &&
    automatic.value === "false" &&
    queue.value?.flagOnly === true,
);

/** The queue says what it is showing rather than asserting one shape of it.
 * Both filters are user-settable, and the link out of "Najaktywniejsi" opens
 * this page with them off, so a fixed "pipeline is not here" line would be
 * false on the very click the page exists for. */
const queueScope = computed(() => {
  const scope =
    automatic.value === "false"
      ? "Zmiany zaproponowane przez ludzi. Tego, co dopisuje pipeline, tu nie ma."
      : automatic.value === "true"
        ? "Zmiany dopisane przez pipeline."
        : "Wszystkie rewizje — i te od ludzi, i te z pipeline'u.";
  return author.value
    ? `${scope} Tylko jedna osoba, najnowsze na górze.`
    : `${scope} Najnowsze na górze.`;
});

/** The empty list speaks for whichever filter emptied it; the success alert
 * owns the one case worth celebrating. */
const queueEmptyText = computed(() =>
  status.value === "pending" && automatic.value === "false" && !author.value
    ? "Nic nie czeka na rozpatrzenie."
    : "Brak zmian pasujących do filtrów.",
);

const isEmptyDefaultQueue = computed(
  () =>
    !queuePending.value &&
    !queueFailed.value &&
    queue.value !== null &&
    queueTotal.value === 0 &&
    !pinned.value &&
    !author.value &&
    status.value === "pending" &&
    automatic.value === "false",
);

const focusAuthor = (uid: string) =>
  writeQuery("kolejka", { author: uid, status: "all", automatic: "all" }, [
    "page",
  ]);

const notice = ref("");
const noticeShown = ref(false);
const error = ref("");
const errorShown = ref(false);

const report = (err: unknown) => {
  const data = (err as { data?: { message?: string } } | null)?.data;
  error.value =
    data?.message || (err instanceof Error ? err.message : "Wystąpił błąd");
  errorShown.value = true;
};

const announce = (text: string) => {
  notice.value = text;
  noticeShown.value = true;
};

const deciding = ref<string | null>(null);
const rejectOpen = ref(false);
const rejectTarget = ref<Proposal | null>(null);

/** A settled proposal leaves the list where it stands, without a refetch: an
 * admin working a queue down loses their place otherwise, and the row they just
 * decided on is the one thing they are certain about. An edge revision leaves
 * "Zmiany powiązań" too, which lists the same revision. */
const settle = (id: string) => {
  if (edges.value?.revisions.some((row) => row.id === id)) {
    edges.value = {
      revisions: edges.value.revisions.filter((row) => row.id !== id),
      total: Math.max(0, edges.value.total - 1),
    };
  }
  if (!queue.value) return;
  queue.value = {
    ...queue.value,
    revisions: queue.value.revisions.filter((row) => row.id !== id),
    total: Math.max(0, queue.value.total - 1),
    pinned: queue.value.pinned?.id === id ? null : queue.value.pinned,
  };
  if (queue.value.revisions.length === 0 && queue.value.total > 0) {
    void loadQueue();
  }
};

const approve = async (
  proposal: Proposal,
  { publish }: { publish: boolean },
) => {
  deciding.value = proposal.id;
  try {
    await authRequest("/api/revisions/approve", {
      body: { revision_id: proposal.id, ...(publish ? { publish: true } : {}) },
    });
    const name = proposal.targetName;
    announce(
      publish
        ? name
          ? `Zatwierdzono i opublikowano „${name}”.`
          : "Zatwierdzono i opublikowano wpis."
        : name
          ? `Zatwierdzono zmianę w „${name}”.`
          : "Zatwierdzono zmianę we wpisie.",
    );
    settle(proposal.id);
  } catch (err) {
    report(err);
  } finally {
    deciding.value = null;
  }
};

const openReject = (proposal: Proposal) => {
  rejectTarget.value = proposal;
  rejectOpen.value = true;
};

const reject = async (reason: string) => {
  const proposal = rejectTarget.value;
  if (!proposal) return;
  deciding.value = proposal.id;
  try {
    await authRequest("/api/revisions/reject", {
      body: { revision_id: proposal.id, reason },
    });
    rejectOpen.value = false;
    announce(
      proposal.targetName
        ? `Odrzucono zmianę w „${proposal.targetName}”.`
        : "Odrzucono zmianę we wpisie.",
    );
    settle(proposal.id);
  } catch (err) {
    report(err);
  } finally {
    deciding.value = null;
  }
};

const copyPermalink = async (proposal: Proposal) => {
  const link = `${window.location.origin}/admin/rewizje?rewizja=${encodeURIComponent(proposal.id)}#kolejka`;
  try {
    await navigator.clipboard.writeText(link);
    announce("Skopiowano link do propozycji.");
  } catch {
    // A browser that refuses the clipboard (no permission, or an insecure
    // origin) still has to leave the reviewer with the link somehow.
    error.value = link;
    errorShown.value = true;
  }
};

// ---------------------------------------------------------------------------
// Zmiany powiązań

// Every edge type the ingest can propose a change to. Only `election` produces
// any today; the rest are here so a later one does not need a code change to
// become filterable.
const edgeTypeOptions = [
  { title: "Kandydatura", value: "election" },
  { title: "Zatrudnienie", value: "employed" },
  { title: "Własność", value: "owns" },
  { title: "Siedziba", value: "seat" },
  { title: "Powiązanie", value: "connection" },
];
const edgeTypeLabels = Object.fromEntries(
  edgeTypeOptions.map((option) => [option.value, option.title]),
);

const edgeType = optionalFilter(
  "powiazania",
  "edgeType",
  edgeTypeOptions.map((option) => option.value),
  "edgePage",
);
const edgePage = pageParam("powiazania", "edgePage");

const edges = ref<{ revisions: PendingEdgeRevision[]; total: number } | null>(
  null,
);
const edgesPending = ref(false);
const edgesFailed = ref(false);

const edgeRows = computed(() => edges.value?.revisions ?? []);
const edgePages = computed(() =>
  Math.ceil((edges.value?.total ?? 0) / EDGE_PAGE_SIZE),
);

let latestEdgeRequest = 0;

const loadEdges = async () => {
  if (import.meta.server || !admin.value) return;

  const request = ++latestEdgeRequest;
  edgesPending.value = true;
  edgesFailed.value = false;
  try {
    const response = await authRequest<{
      revisions: PendingEdgeRevision[];
      total: number;
    }>("/api/revisions/pendingEdges", {
      method: "GET",
      query: {
        page: edgePage.value,
        limit: EDGE_PAGE_SIZE,
        type: edgeType.value || undefined,
      },
    });
    if (request !== latestEdgeRequest) return;
    edges.value = response;
  } catch (err) {
    if (request !== latestEdgeRequest) return;
    console.error("Failed to load the pending edge revisions", err);
    edges.value = null;
    edgesFailed.value = true;
  } finally {
    if (request === latestEdgeRequest) {
      edgesPending.value = false;
      void scrollWhenLoaded();
    }
  }
};

watch([edgePage, edgeType, admin], loadEdges, { immediate: true });

// ---------------------------------------------------------------------------
// Wpisy z historią zmian

// Written out rather than mapped over `nodeTypes`, because the select needs a
// Polish name per type and the raw values are the ones the api takes - they are
// what ends up in the url too, so the two lists have to agree.
const nodeTypeLabels: Record<NodeType, string> = {
  person: "Osoba",
  place: "Firma",
  article: "Artykuł",
  region: "Region",
  topic: "Temat",
};
const nodeTypeOptions = Object.entries(nodeTypeLabels).map(
  ([value, title]) => ({ title, value: value as NodeType }),
);

const nodeStatusOptions = [
  { title: "Oczekujące na akceptację", value: "unapproved" },
  { title: "W pełni zaakceptowane", value: "approved" },
];

/** The two orders worth offering, each both ways round. Kept in the url as
 * `sortBy` and `sortDesc`, the names the table here used to write, so a link
 * copied from it still sorts the same. The table could also sort by the
 * "Zaakceptowane" column; that is the "Stan" filter now. */
const nodeSortOptions = [
  { title: "Najnowsze zmiany", value: "revisions.latest_time:desc" },
  { title: "Najstarsze zmiany", value: "revisions.latest_time:asc" },
  { title: "Najwięcej rewizji", value: "revisions.total:desc" },
  { title: "Najmniej rewizji", value: "revisions.total:asc" },
];
const DEFAULT_NODE_SORT = "revisions.latest_time:desc";

const nodeStatus = optionalFilter(
  "wpisy",
  "nodeStatus",
  ["unapproved", "approved"] as const,
  "nodePage",
);
const nodeType = optionalFilter(
  "wpisy",
  "nodeType",
  Object.keys(nodeTypeLabels) as NodeType[],
  "nodePage",
);
const nodeSort = computed<string>({
  get: () => {
    const value = `${readQuery("sortBy")}:${readQuery("sortDesc") === "false" ? "asc" : "desc"}`;
    return nodeSortOptions.some((option) => option.value === value)
      ? value
      : DEFAULT_NODE_SORT;
  },
  set: (value) => {
    const [key, order] = value.split(":");
    writeQuery(
      "wpisy",
      value === DEFAULT_NODE_SORT
        ? { sortBy: undefined, sortDesc: undefined }
        : { sortBy: key, sortDesc: order === "desc" ? "true" : "false" },
      ["nodePage"],
    );
  },
});
const nodePage = pageParam("wpisy", "nodePage");
const nodePerPage = pageSizeParam("wpisy", "nodePerPage", "nodePage", 10);

const nodes = ref<{ nodes: Record<string, RevisedNode>; total: number } | null>(
  null,
);
const nodesPending = ref(false);
const nodesFailed = ref(false);

const nodeRows = computed(() => Object.values(nodes.value?.nodes ?? {}));
const nodePages = computed(() =>
  Math.ceil((nodes.value?.total ?? 0) / nodePerPage.value),
);

const nodeQuery = computed(() => {
  const [sortBy, order] = nodeSort.value.split(":");
  return {
    page: nodePage.value,
    limit: nodePerPage.value,
    sortBy,
    sortDesc: order === "desc" ? "true" : "false",
    status: nodeStatus.value ?? undefined,
    type: nodeType.value ?? undefined,
  };
});

let latestNodeRequest = 0;

const loadNodes = async () => {
  if (import.meta.server) return;

  const request = ++latestNodeRequest;
  nodesPending.value = true;
  nodesFailed.value = false;
  try {
    // The endpoint reads no token; this goes through `authRequest` anyway, as
    // the other two sections do, so the page has one way of asking - and one
    // thing for a test to stand in for.
    const response = await authRequest<{
      nodes: Record<string, RevisedNode>;
      total: number;
    }>("/api/nodes/revisions", { method: "GET", query: nodeQuery.value });
    if (request !== latestNodeRequest) return;
    nodes.value = response;
  } catch (err) {
    if (request !== latestNodeRequest) return;
    console.error("Failed to load the revised entries", err);
    nodes.value = null;
    nodesFailed.value = true;
  } finally {
    if (request === latestNodeRequest) {
      nodesPending.value = false;
      void scrollWhenLoaded();
    }
  }
};

watch([nodePage, nodePerPage, nodeSort, nodeStatus, nodeType], loadNodes, {
  immediate: true,
});

/** A decision taken inside an entry's history changes the entry's line and,
 * when it was somebody's proposal, the queue - both are read again. */
const onHistoryChanged = () => {
  void loadNodes();
  void loadQueue();
};

// ---------------------------------------------------------------------------
// Arriving at an anchor

/** Where the page still owes the reader a scroll: the section named by the
 * hash it was opened with, or the row a permalink names.
 *
 * Nuxt scrolls to a hash as soon as the route resolves, which is before any
 * row has arrived - the target is at the top of an empty page then, and the
 * sections above it push it down as they fill. So the scroll is kept until
 * every section this reader can see has loaded, and spent once. */
const scrollTarget = ref<string | null>(null);

const initialSection = route.hash.slice(1) as SectionId;
if (permalinked.value) scrollTarget.value = `rewizja-${permalinked.value}`;
else if (SECTIONS.includes(initialSection)) scrollTarget.value = initialSection;

// "Rozpatrz" on an edge row, or any other link that pins a proposal while the
// page is already open.
watch(permalinked, (id) => {
  if (id) scrollTarget.value = `rewizja-${id}`;
});

const everythingLoaded = computed(() => {
  if (isAdmin.value === undefined) return false;
  const nodesDone = !nodesPending.value && (nodes.value || nodesFailed.value);
  if (!admin.value) return !!nodesDone;
  return (
    !!nodesDone &&
    !queuePending.value &&
    !!(queue.value || queueFailed.value) &&
    !edgesPending.value &&
    !!(edges.value || edgesFailed.value)
  );
});

/** Whether the page is in the document yet. A quick answer can come back
 * before it is, and `getElementById` would then find nothing to scroll to. */
let inDocument = false;
onMounted(() => {
  inDocument = true;
  void scrollWhenLoaded();
});

async function scrollWhenLoaded() {
  if (!inDocument || !scrollTarget.value || !everythingLoaded.value) return;
  const target = scrollTarget.value;
  scrollTarget.value = null;
  await nextTick();
  // A permalink to a proposal that no longer exists has no row; its section
  // is the next best place.
  const element =
    document.getElementById(target) ??
    (target.startsWith("rewizja-") ? document.getElementById("kolejka") : null);
  element?.scrollIntoView({ block: "start" });
}

// Nothing else re-checks once a non-admin's only section has loaded before
// their claims were read.
watch(
  () => isAdmin.value,
  () => void scrollWhenLoaded(),
);
</script>

<style scoped>
/* Clears the sticky toolbar when an anchor scrolls a section into view - the
 * same allowance the rows make. */
.rev-section {
  scroll-margin-top: 96px;
}

/* Fixed widths rather than the field's own, which is as wide as its longest
 * option. Narrower than a phone either way: the head wraps them onto lines of
 * their own there instead of running past the edge. */
.rev-filter {
  width: 11rem;
  max-width: 100%;
  flex: 0 1 auto;
}

.rev-filter--wide {
  width: 15rem;
}

.rev-per-page {
  width: 8rem;
  flex: none;
}
</style>
