<template>
  <v-card class="mb-4" rounded="lg">
    <v-card-title>Twoje propozycje zmian</v-card-title>
    <v-card-subtitle v-if="subtitle" class="text-wrap">
      {{ subtitle }}
    </v-card-subtitle>

    <v-card-text>
      <v-progress-linear
        v-if="pending && !loaded"
        indeterminate
        color="primary"
        class="mb-4"
      />

      <v-alert
        v-if="failed"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-4"
        text="Nie udało się wczytać Twoich propozycji. Odśwież stronę."
      />

      <div v-if="anyProposals" class="d-flex flex-wrap ga-2 mb-3">
        <!-- A chip both counts a state and selects it. `Zastąpione` only
             counts: it has no stored form to filter on - see
             `matchesStoredStatus` - and asking for it would really be asking
             for approved. -->
        <v-chip
          v-for="chip in summaryChips"
          :key="chip.status"
          :color="chip.color"
          :variant="chip.active ? 'flat' : 'tonal'"
          size="small"
          :link="chip.selectable"
          :disabled="chip.filterable && !chip.selectable"
          :aria-pressed="chip.filterable ? chip.active : undefined"
          :data-testid="`proposal-filter-${chip.status}`"
          @click="chip.selectable ? toggleFilter(chip.status) : undefined"
        >
          {{ chip.label }} {{ chip.count }}
        </v-chip>

        <v-btn
          v-if="statusFilter !== 'all'"
          size="x-small"
          variant="text"
          :prepend-icon="mdiClose"
          data-testid="proposal-filter-clear"
          @click="clearFilter"
        >
          Pokaż wszystkie
        </v-btn>
      </div>

      <!-- Approved and superseded share one stored status, so the filter
           cannot separate them and says so rather than looking like it
           miscounted against the chip above. -->
      <div
        v-if="statusFilter === 'approved' && counts.superseded > 0"
        class="text-caption text-medium-emphasis mb-3"
      >
        Razem z zastąpionymi - dla bazy to jedno i to samo „zatwierdzone”.
      </div>

      <v-alert
        v-if="loaded && !anyProposals"
        type="info"
        variant="tonal"
        density="compact"
      >
        <!-- A pipeline account's newest 300 writes are all automatic, so it
             lands here with nothing to show. Saying "you have never proposed
             anything" would be a guess about the 299th record back. -->
        <template v-if="truncated">
          Wśród {{ SCAN_CAP }} ostatnich zapisów na Twoim koncie nie ma nic
          zgłoszonego ręcznie — starsze są poza tym zestawieniem.
        </template>
        <template v-else>
          Nie zgłosiłeś jeszcze żadnej zmiany. Na każdej stronie jest przycisk
          „Zaproponuj zmianę” — poprawka jednego nazwiska też się liczy.
        </template>
      </v-alert>

      <template v-for="(row, index) in rows" :key="row.id">
        <v-divider v-if="index > 0" />
        <div class="py-3">
          <div class="d-flex align-center flex-wrap ga-2">
            <!-- The entry as this proposal would leave it: `revisionId` makes
                 the page render the revision over the stored node. -->
            <NuxtLink
              v-if="row.targetPath"
              :to="`${row.targetPath}?revisionId=${row.id}`"
              class="link-plain text-body-2 font-weight-medium"
            >
              {{ rowName(row) }}
            </NuxtLink>
            <span v-else class="text-body-2 font-weight-medium">
              {{ rowName(row) }}
            </span>

            <ChipRevisionStatus
              :status="row.status"
              :derived="row.statusDerived"
              size="x-small"
            />

            <v-spacer />

            <span class="text-caption text-medium-emphasis text-no-wrap">
              {{ formatDaysAgo(row.updateTime) }}
            </span>
          </div>

          <div v-if="row.kind === 'removal'" class="text-body-2 mt-1">
            Powód usunięcia: {{ row.deleteReason || "nie podano" }}
          </div>
          <RevisionDiff
            v-else
            :changes="row.changes"
            :change-count="row.changeCount"
            :max="3"
            class="mt-1"
          />

          <!-- The reason is the whole of the answer a rejected contributor
               came here for, so it is inline text and not a tooltip. -->
          <v-alert
            v-if="row.status === 'rejected'"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-2"
            :text="
              row.rejectReason
                ? `Powód: ${row.rejectReason}`
                : proposalStatusHints.rejected
            "
          />

          <v-btn
            v-if="row.status === 'approved' && row.published && row.targetPath"
            size="x-small"
            variant="text"
            class="mt-2"
            :to="row.targetPath"
            :prepend-icon="mdiEarth"
          >
            Zobacz na stronie
          </v-btn>
          <div
            v-else-if="row.status === 'approved' && !row.published"
            class="text-caption text-medium-emphasis mt-2"
          >
            Zmiana przyjęta. Strona czeka jeszcze na publikację.
          </div>
        </div>
      </template>

      <div v-if="hasMore" class="mt-1">
        <v-btn variant="text" size="small" :loading="pending" @click="loadMore">
          Pokaż starsze
        </v-btn>
      </div>

      <div
        v-if="truncated && anyProposals"
        class="text-caption text-medium-emphasis mt-2"
      >
        Wczytaliśmy {{ SCAN_CAP }} najnowszych zapisów na Twoim koncie — starsze
        są poza tym zestawieniem.
      </div>

      <div class="text-caption text-medium-emphasis mt-3">
        Zatwierdzenie zmiany to jeszcze nie publikacja — stronę publikuje
        redakcja osobno.
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { mdiClose, mdiEarth } from "@mdi/js";
import { authRequest, useAuthState } from "~/composables/auth";
import { polishCounting } from "~/composables/polish";
import { formatDaysAgo } from "~/utils/chartTheme";
import {
  emptyProposalCounts,
  proposalStatuses,
  proposalStatusHints,
  proposalStatusLabels,
  type Proposal,
  type ProposalCounts,
  type ProposalStatus,
  type StoredStatusFilter,
} from "~~/shared/proposals";
import {
  notificationEnabled,
  notificationKinds,
} from "~~/shared/notifications";
import type { MyProposals } from "~~/server/api/revisions/mine.get";

/** What became of what this user proposed.
 *
 * The counterpart of `/admin/rewizje/kolejka`: the same rows, read from the
 * other side. A contributor is otherwise told nothing at all - the emails only
 * go out on a decision, so a proposal nobody has looked at leaves no trace
 * anywhere the author can see.
 */

const PAGE_SIZE = 10;

/** Mirrors `MINE_SCAN_CAP` in `/api/revisions/mine`. Not imported from there:
 * the module pulls in firebase-admin, and only its type survives the build. */
const SCAN_CAP = 300;

const rows = ref<Proposal[]>([]);
const counts = ref<ProposalCounts>(emptyProposalCounts());
const total = ref(0);
const truncated = ref(false);
const page = ref(0);
/** Which state the list is narrowed to, in the stored vocabulary the endpoint
 * speaks. Paging and the filter share one request, so a narrowed list pages
 * through its own matches rather than through everything. */
const statusFilter = ref<StoredStatusFilter>("all");
const pending = ref(false);
const loaded = ref(false);
const failed = ref(false);

const loadPage = async (next: number) => {
  pending.value = true;
  failed.value = false;
  try {
    const response = await authRequest<MyProposals>("/api/revisions/mine", {
      method: "GET",
      query: { limit: PAGE_SIZE, page: next, status: statusFilter.value },
    });
    rows.value =
      next === 1 ? response.revisions : [...rows.value, ...response.revisions];
    counts.value = response.counts;
    total.value = response.total;
    truncated.value = response.truncated;
    page.value = next;
    loaded.value = true;
  } catch (error) {
    console.error("Failed to load own proposals", error);
    failed.value = true;
  } finally {
    pending.value = false;
  }
};

// Client only, and deliberately: the endpoint answers a bearer token that the
// server render has no way to present.
onMounted(() => void loadPage(1));

const loadMore = () => void loadPage(page.value + 1);

/** Clicking the selected state clears the filter, so the same chip is both the
 * way in and the way out. Always back to page one: the offsets belong to the
 * previous selection. */
const toggleFilter = (status: ProposalStatus) => {
  const next = status === "superseded" ? "approved" : status;
  statusFilter.value = statusFilter.value === next ? "all" : next;
  void loadPage(1);
};

const clearFilter = () => {
  statusFilter.value = "all";
  void loadPage(1);
};

const hasMore = computed(() => rows.value.length < total.value);
/** Read off the counts, not off `total`: `total` is the filtered set, and a
 * reader who narrowed to one state has not stopped having proposals. */
const anyProposals = computed(() =>
  proposalStatuses.some((status) => counts.value[status] > 0),
);

const { user, userConfig } = useAuthState();

/** Whether the promise of an email is one the site can keep.
 *
 * `notifyUser` refuses an unverified address, and refuses a kind the user
 * switched off - both of which are set in the card directly below this one,
 * which already says "dopóki nie potwierdzisz adresu email, nie wyślemy na
 * niego żadnej wiadomości". Promising mail regardless would contradict it on
 * the same screen, and would do so for exactly the people who signed up with an
 * email and a password and never confirmed the address. */
const mailWillBeSent = computed(
  () =>
    !!user.value?.emailVerified &&
    notificationKinds.every((kind) =>
      notificationEnabled(kind, userConfig?.data?.value?.notifications),
    ),
);

const subtitle = computed(() => {
  const waiting = counts.value.pending;
  if (waiting > 0) {
    // Whoever has twelve proposals sitting unread is not to be thanked for
    // them yet; they are told what is happening to them.
    const head = `${polishCounting(waiting, "propozycja czeka", "propozycje czekają", "propozycji czeka")} na redakcję.`;
    return mailWillBeSent.value
      ? `${head} Odezwiemy się mailem, gdy ktoś się ${waiting === 1 ? "nią" : "nimi"} zajmie.`
      : `${head} Decyzję zobaczysz tutaj — powiadomienia mailem masz wyłączone.`;
  }
  if (anyProposals.value)
    return "Wszystko, co zgłosiłeś, zostało rozpatrzone. Dzięki!";
  return null;
});

/** The chips count proposals, so they read as plurals; `proposalStatusLabels`
 * names a single one and stays the source of the colour, so this card and the
 * review queue cannot end up disagreeing about what green means. */
const countLabels: Record<ProposalStatus, string> = {
  approved: "Zatwierdzone",
  pending: "Oczekujące",
  rejected: "Odrzucone",
  superseded: "Zastąpione",
};

/** Approved, pending and rejected are shown even at zero - `Odrzucone 0` is
 * worth reading. `Zastąpione` is a state nobody proposed anything to reach, so
 * it only appears once it has actually happened, and it goes last: it is the
 * footnote to `Zatwierdzone`, not a fourth thing of the same weight. */
const chipOrder: ProposalStatus[] = [
  "approved",
  "pending",
  "rejected",
  "superseded",
];

/** How many rows `?status=` would return for a chip. See `matchesStoredStatus`:
 * approved and superseded are one stored status and cannot be asked for
 * separately. */
const selects = (status: ProposalStatus) =>
  status === "approved"
    ? counts.value.approved + counts.value.superseded
    : counts.value[status];

const summaryChips = computed(() =>
  chipOrder
    .filter((status) => status !== "superseded" || counts.value.superseded > 0)
    .map((status) => ({
      status,
      label: countLabels[status],
      color: proposalStatusLabels[status].color,
      count: counts.value[status],
      filterable: status !== "superseded",
      // What the filter would actually return, which is not the chip's own
      // count for `approved`: superseded proposals share its stored status and
      // come back with it. A chip that would select nothing is not offered -
      // `disabled` on a v-chip is a look, not a guard, so the click checks too.
      selectable: status !== "superseded" && selects(status) > 0,
      active: statusFilter.value === status,
    })),
);

/** What to call the entry a row is about. A proposal against something that has
 * since been deleted keeps its row - it was still made - so it says so instead
 * of rendering as a blank line. */
const rowName = (row: Proposal) =>
  row.targetName ?? (row.targetExists ? "Wpis bez nazwy" : "Usunięty wpis");
</script>
