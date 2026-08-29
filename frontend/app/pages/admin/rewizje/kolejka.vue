<template>
  <div class="pa-4">
    <div class="d-flex align-start flex-wrap ga-3 mb-4">
      <div class="flex-grow-1">
        <h1 class="text-h5 text-sm-h4 mb-1">Kolejka zmian</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">{{ subtitle }}</p>
      </div>
      <v-btn
        variant="text"
        size="small"
        :prepend-icon="mdiFormatListBulleted"
        to="/admin/rewizje"
      >
        Wszystkie rewizje
      </v-btn>
    </div>

    <v-card class="mb-4 pa-3">
      <v-row dense align="center">
        <v-col cols="12" sm="6" md="3">
          <v-select
            v-model="status"
            :items="statusOptions"
            label="Status"
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-col>
        <v-col cols="12" sm="6" md="3">
          <v-select
            v-model="automatic"
            :items="automaticOptions"
            label="Rodzaj"
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-col>
        <v-col v-if="author" cols="12" md="6">
          <!-- No dropdown of people: there is no client-side list of uids, and
               the way in is a click from "Najaktywniejsi" on /eksploruj/statystyki. -->
          <v-chip closable variant="tonal" @click:close="author = null">
            <span class="mr-1">Tylko:</span>
            <UserChip :uid="author" />
          </v-chip>
        </v-col>
      </v-row>
    </v-card>

    <!-- The list an admin is looking at is not the whole history, and saying so
         is the difference between a queue and a lie. -->
    <v-alert
      v-if="showsFlagOnlyNotice"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      Ta lista obejmuje propozycje zgłoszone od lipca 2026 — wcześniejsze
      rewizje nie mają zapisanego, czy powstały ręcznie. Pełną historię jednej
      osoby zobaczysz, klikając jej nazwę w „Najaktywniejsi” na
      <NuxtLink to="/eksploruj/statystyki">stronie statystyk</NuxtLink>.
    </v-alert>

    <v-alert
      v-if="data?.truncated"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-4"
      :text="`Wczytaliśmy ${AUTHOR_SCAN_CAP} najnowszych rewizji tej osoby. Starsze są poza tym zestawieniem.`"
    />

    <v-alert
      v-if="failed"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-4"
      text="Nie udało się wczytać kolejki."
    />

    <v-card v-if="data?.pinned" variant="outlined" class="mb-4">
      <v-card-item>
        <v-card-subtitle>Propozycja z linku</v-card-subtitle>
      </v-card-item>
      <v-card-text>
        <v-alert
          v-if="data.pinned.status !== 'pending'"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-3"
          text="Ta propozycja została już rozpatrzona."
        />
        <div class="d-flex flex-column ga-2">
          <div class="d-flex flex-wrap align-center ga-2">
            <RevisionTargetCell :proposal="data.pinned" />
            <v-spacer />
            <ChipRevisionStatus
              :status="data.pinned.status"
              :derived="data.pinned.statusDerived"
            />
            <UserChip
              :uid="data.pinned.updateUser"
              :user="data.pinned.author"
            />
          </div>
          <div>
            <div class="text-caption text-medium-emphasis mb-1">
              {{ formatDaysAgo(data.pinned.updateTime) }} ·
              {{ formatMoment(data.pinned.updateTime) }}
            </div>
            <RevisionChangeCell :proposal="data.pinned" />
          </div>
          <RevisionReviewActions
            :proposal="data.pinned"
            :reviewable="data.pinned.status === 'pending'"
            :loading="deciding === data.pinned.id"
            :full-comparison-to="comparisonTo(data.pinned)"
            @approve="approve(data.pinned!, $event)"
            @reject="openReject(data.pinned!)"
            @permalink="copyPermalink(data.pinned!)"
          />
        </div>
      </v-card-text>
    </v-card>

    <v-alert
      v-if="isEmptyDefaultQueue"
      type="success"
      variant="tonal"
      :prepend-icon="mdiCheckDecagramOutline"
      text="Kolejka jest pusta — nic nie czeka na rozpatrzenie."
    />

    <v-card v-else>
      <v-data-table-server
        v-model:items-per-page="itemsPerPage"
        v-model:page="page"
        density="compact"
        :headers="headers"
        :items="items"
        :items-length="total"
        :loading="pending"
        item-value="id"
        :items-per-page-options="[10, 25, 50, 100]"
        :no-data-text="noDataText"
        loading-text="Ładowanie..."
        items-per-page-text="Wierszy na stronę:"
      >
        <!-- Who proposed it and when, as one thing: the two used to sit at
             opposite ends of the row, and reading a queue entry meant looking
             them up against each other. -->
        <template #[`item.submission`]="{ item }">
          <div class="d-flex flex-column align-start ga-1 py-1">
            <a
              class="cursor-pointer"
              title="Pokaż wszystko, co ta osoba zaproponowała"
              @click="focusAuthor(item.updateUser)"
            >
              <UserChip :uid="item.updateUser" :user="item.author" />
            </a>
            <!-- Two lines rather than one: in a 200px column the pair runs
                 past the edge, and "3 dni temu" is the half that gets read. -->
            <div class="text-caption text-no-wrap">
              {{ formatDaysAgo(item.updateTime) }}
            </div>
            <div class="text-caption text-medium-emphasis text-no-wrap">
              {{ formatMoment(item.updateTime) }}
            </div>
            <div class="d-flex align-center flex-wrap ga-1">
              <ChipRevisionStatus
                :status="item.status"
                :derived="item.statusDerived"
                size="x-small"
              />
              <!-- Only meaningful once the list can mix the two, which the
                   "Wszystko" filter and the link from "Najaktywniejsi" both do. -->
              <v-chip v-if="item.automatic" size="x-small" variant="tonal">
                Pipeline
              </v-chip>
            </div>
          </div>
        </template>

        <template #[`item.target`]="{ item }">
          <RevisionTargetCell :proposal="item" />
        </template>

        <template #[`item.changes`]="{ item }">
          <RevisionChangeCell :proposal="item" />
        </template>

        <!-- One button, not five. Deciding needs the whole revision next to
             the ones around it, which is the comparison view - so the row
             sends the reviewer there with this revision picked out, instead
             of packing approve, publish, reject, compare and copy-link into
             the narrowest column of the table.

             One button also means one label. It used to name its own
             destination, so a relation read "Rewizje powiązań" and a decided
             proposal "Zobacz" - three widths of button in one column, which
             read as three tools rather than as one repeated control. Where it
             goes is now in the tooltip; the row already says both facts the
             label was spending itself on. -->
        <template #[`item.actions`]="{ item }">
          <v-btn
            variant="tonal"
            size="small"
            :prepend-icon="mdiCompare"
            :to="reviewTo(item)"
            :title="reviewHint(item)"
            :data-testid="`review-${item.id}`"
          >
            {{ REVIEW_LABEL }}
          </v-btn>
        </template>
      </v-data-table-server>
    </v-card>

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
/** The review queue: one row per proposal, human work first.
 *
 * `/admin/rewizje` answers a different question - which *entries* have
 * unreviewed history - and it cannot answer this one, because authorship lives
 * on the revision rather than on the node, and because 96% of the revisions in
 * the collection were written by the pipeline. So a volunteer's suggestion was
 * visible only as a number in "Najaktywniejsi" with nothing behind it.
 *
 * Two modes, and the difference matters. Without `?author=` the endpoint can
 * only see revisions that carry an explicit `update_automatic` flag, which
 * nothing wrote for a human change before July 2026; with it, it reads one
 * person's revisions whole and filters in memory, so it sees everything they
 * ever proposed. The link out of the contributor table uses the second, which
 * is why that is the click the owner was missing.
 */
import { computed, ref, watch } from "vue";
import {
  mdiCheckDecagramOutline,
  mdiCompare,
  mdiFormatListBulleted,
} from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { useQueryFilters } from "~/composables/queryFilters";
import { formatDaysAgo } from "~/utils/chartTheme";
import type { Proposal } from "~~/shared/proposals";
import type { RevisionQueue } from "~~/server/api/revisions/queue.get";

definePageMeta({
  middleware: "admin",
  fullWidth: true,
});

useHead({ title: "Kolejka zmian (Admin) - koryta.pl" });

/** Mirrors `AUTHOR_SCAN_CAP` in `/api/revisions/queue`; the module itself pulls
 * in firebase-admin, so only its type survives into the client bundle. */
const AUTHOR_SCAN_CAP = 500;

const { setQuery, stringFilter, choiceFilter, numberFilter } = useQueryFilters({
  resetOnChange: ["page"],
});

const status = choiceFilter<"pending" | "approved" | "rejected" | "all">(
  "status",
  "pending",
);
const automatic = choiceFilter<"false" | "true" | "all">("automatic", "false");
const author = stringFilter("author");
/** Not a filter but a selector: it names one proposal to answer with, and the
 * endpoint returns it whether or not the current filters would have. */
const permalinked = stringFilter("rewizja");

const pageFilter = numberFilter("page");
const perPageFilter = numberFilter("itemsPerPage");

/** Paging is the table's own state rather than a filter, so it goes through
 * `setQuery` and not through the filter setter.
 *
 * `numberFilter` always writes with `{ reset: true }`, and `setQuery` drops
 * every `resetOnChange` key from the patch as well as from the current query -
 * so a `page` filter under `resetOnChange: ["page"]` discards the very key it
 * is being asked to set, and the footer arrows do nothing at all. */
const page = computed({
  get: () => pageFilter.value ?? 1,
  set: (value: number) =>
    void setQuery({ page: value > 1 ? String(value) : undefined }),
});
const itemsPerPage = computed({
  get: () => perPageFilter.value ?? 25,
  set: (value: number) =>
    void setQuery({
      itemsPerPage: value === 25 ? undefined : String(value),
      // A different page size makes the current page number meaningless.
      page: undefined,
    }),
});

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

// "Zgłoszenie" is who and when in one column, first, because that is the pair
// a reviewer reads to decide whether a row is worth opening. "Czego dotyczy"
// is capped by RevisionTargetCell rather than here: a width on the header is a
// hint the table's auto layout may ignore, and an article title ignored it.
const headers = [
  { title: "Zgłoszenie", key: "submission", sortable: false, width: 200 },
  { title: "Czego dotyczy", key: "target", sortable: false },
  { title: "Proponowana zmiana", key: "changes", sortable: false },
  { title: "", key: "actions", sortable: false, align: "end" as const },
];

const data = ref<RevisionQueue | null>(null);
const pending = ref(false);
const failed = ref(false);

const items = computed(() => data.value?.revisions ?? []);
const total = computed(() => data.value?.total ?? 0);

const apiQuery = computed(() => ({
  page: page.value,
  limit: itemsPerPage.value,
  status: status.value,
  automatic: automatic.value,
  author: author.value || undefined,
  revision: permalinked.value || undefined,
}));

// Requests can land out of order once a filter and a page change chase each
// other, so only the newest one is allowed to write the table.
let latestRequest = 0;

const load = async () => {
  // The endpoint only answers a caller carrying an admin token, which the
  // server render has no way to present - it would spend a request on a 401.
  if (import.meta.server) return;

  const request = ++latestRequest;
  pending.value = true;
  failed.value = false;
  try {
    const response = await authRequest<RevisionQueue>("/api/revisions/queue", {
      method: "GET",
      query: apiQuery.value,
    });
    if (request !== latestRequest) return;
    data.value = response;
  } catch (err) {
    if (request !== latestRequest) return;
    console.error("Failed to load the review queue", err);
    data.value = null;
    failed.value = true;
  } finally {
    if (request === latestRequest) pending.value = false;
  }
};

watch(apiQuery, load, { immediate: true });

/** The aggregate list cannot see revisions written before the flag existed, and
 * a reader has no way to tell that from a quiet week. Only said where it is
 * true: the per-author mode has no such gap. */
const showsFlagOnlyNotice = computed(
  () =>
    !author.value &&
    automatic.value === "false" &&
    data.value?.flagOnly === true,
);

/** The queue says what it is showing rather than asserting one shape of it.
 * Both filters are user-settable, and the link out of "Najaktywniejsi" opens
 * this page with them off, so a fixed "pipeline is not here" line would be
 * false on the very click the page exists for. */
const subtitle = computed(() => {
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

/** The empty table speaks for whichever filter emptied it; the success alert
 * above already owns the one case worth celebrating. */
const noDataText = computed(() =>
  status.value === "pending" && automatic.value === "false" && !author.value
    ? "Nic nie czeka na rozpatrzenie."
    : "Brak zmian pasujących do filtrów.",
);

const isEmptyDefaultQueue = computed(
  () =>
    !pending.value &&
    !failed.value &&
    total.value === 0 &&
    !data.value?.pinned &&
    !author.value &&
    status.value === "pending" &&
    automatic.value === "false",
);

const formatMoment = (value: string | null) =>
  value ? new Date(value).toLocaleString("pl-PL") : "-";

/** The side-by-side view, which only exists for nodes: an edge revision is
 * reviewed on /admin/rewizje-krawedzi, which lists relations rather than
 * versions of one entry. Null here is what marks a row as an edge one, so both
 * the destination and the tooltip below read it rather than re-testing
 * `targetCollection`. */
const comparisonTo = (proposal: Proposal) =>
  proposal.targetCollection === "nodes" && proposal.targetId
    ? `/admin/rewizje/${proposal.targetId}?revisionId=${proposal.id}`
    : null;

/** Where the row's one button goes. An edge revision has no per-node
 * comparison view - the comparison screen is node-shaped down to its "Podgląd
 * tej wersji strony" link - so it goes to the page that reviews relations,
 * carrying its own id: a button that promises "this proposal" and lands on an
 * unmarked list of forty has not kept the promise. `rewizja` is the key the
 * queue's own permalink already uses. */
const reviewTo = (proposal: Proposal) =>
  comparisonTo(proposal) ?? `/admin/rewizje-krawedzi?rewizja=${proposal.id}`;

/** One label, on every row. The button used to say "Rewizje powiązań" for a
 * relation and "Zobacz" for a proposal already decided, so the narrowest
 * column of the table held three differently sized controls and read as three
 * different tools. Neither fact was the button's to tell: "Czego dotyczy"
 * already carries the `Powiązanie` chip, and "Zgłoszenie" already carries the
 * status. The button does one thing on every row, so it says one thing. */
const REVIEW_LABEL = "Rozpatrz";

/** What the button will open. The label is deliberately identical everywhere,
 * so the one thing that genuinely differs between rows is said here instead -
 * as a tooltip, which costs the column no width. */
const reviewHint = (proposal: Proposal) =>
  comparisonTo(proposal)
    ? "Otwiera porównanie rewizji tego wpisu"
    : "Otwiera listę rewizji powiązań, z tą propozycją podświetloną";

const focusAuthor = (uid: string) => {
  author.value = uid;
  status.value = "all";
  automatic.value = "all";
};

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
 * decided on is the one thing they are certain about. */
const settle = (id: string) => {
  if (!data.value) return;
  data.value = {
    ...data.value,
    revisions: data.value.revisions.filter((row) => row.id !== id),
    total: Math.max(0, data.value.total - 1),
    pinned: data.value.pinned?.id === id ? null : data.value.pinned,
  };
  if (data.value.revisions.length === 0 && data.value.total > 0) void load();
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
  const link = `${window.location.origin}/admin/rewizje/kolejka?rewizja=${proposal.id}`;
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
</script>
