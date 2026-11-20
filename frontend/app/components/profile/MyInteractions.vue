<template>
  <v-card class="mb-4" rounded="lg" data-testid="my-interactions">
    <v-card-title>Twoje interakcje</v-card-title>
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
        text="Nie udało się wczytać Twoich interakcji. Odśwież stronę."
      />
      <v-alert
        v-else-if="votesFailed"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-4"
        text="Nie udało się wczytać Twoich głosów. Poniżej są same propozycje."
        data-testid="votes-failed"
      />

      <div v-if="anyInteractions" class="d-flex flex-wrap ga-2 mb-3">
        <!-- A chip both counts and selects. `Zastąpione` only counts: it has
             no stored form to filter on - see `matchesStoredStatus` - and
             asking for it would really be asking for approved. -->
        <v-chip
          v-for="chip in chips"
          :key="chip.key"
          :color="chip.color"
          :variant="chip.active ? 'flat' : 'tonal'"
          size="small"
          :link="chip.selectable"
          :disabled="chip.filterable && !chip.selectable"
          :aria-pressed="chip.filterable ? chip.active : undefined"
          :data-testid="chip.testid"
          @click="chip.selectable ? toggleFilter(chip.key) : undefined"
        >
          {{ chip.label }} {{ chip.count }}
        </v-chip>

        <v-btn
          v-if="filter !== 'all'"
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
        v-if="filter === 'approved' && counts.superseded > 0"
        class="text-caption text-medium-emphasis mb-3"
      >
        Razem z zastąpionymi - dla bazy to jedno i to samo „zatwierdzone”.
      </div>

      <v-alert
        v-if="loaded && !anyInteractions"
        type="info"
        variant="tonal"
        density="compact"
      >
        <!-- A pipeline account's newest 300 writes are all automatic, so it
             lands here with nothing to show. Saying "you have never proposed
             anything" would be a guess about the 299th record back. -->
        <template v-if="truncated.proposals">
          Wśród {{ SCAN_CAP }} ostatnich zapisów na Twoim koncie nie ma nic
          zgłoszonego ręcznie - starsze są poza tym zestawieniem.
        </template>
        <template v-else>
          Nie masz jeszcze głosów ani propozycji zmian. Głosujesz w
          <NuxtLink to="/eksploruj/nowe" class="empty-link">kolejce</NuxtLink>,
          a zmianę zgłaszasz przyciskiem „Zaproponuj zmianę” na każdej stronie.
        </template>
      </v-alert>

      <template v-for="(item, index) in items" :key="itemKey(item)">
        <v-divider v-if="index > 0" />

        <div
          v-if="item.kind === 'vote'"
          class="interaction-row py-3"
          data-testid="my-vote"
        >
          <div class="interaction-row__main">
            <NuxtLink
              v-if="item.vote.path"
              :to="item.vote.path"
              class="vote-link link-plain text-body-2 font-weight-medium"
            >
              {{ item.vote.name }}
            </NuxtLink>
            <span v-else class="text-body-2 font-weight-medium">
              {{ item.vote.name ?? "Usunięty wpis" }}
            </span>

            <span class="text-body-2 text-medium-emphasis text-no-wrap">
              <strong :class="`text-${verdictColor(item.vote.value)}`">
                {{ signed(item.vote.value) }}
              </strong>
              {{ voteLevelLabel("interesting", item.vote.value) }}
            </span>
          </div>

          <span class="text-caption text-medium-emphasis text-no-wrap">
            {{ formatDaysAgo(item.vote.updatedAt) }}
          </span>
        </div>

        <div v-else class="py-3" data-testid="my-proposal">
          <div class="interaction-row">
            <div class="interaction-row__main">
              <!-- The entry as this proposal would leave it: `revisionId`
                   makes the page render the revision over the stored node. -->
              <NuxtLink
                v-if="item.proposal.targetPath"
                :to="`${item.proposal.targetPath}?revisionId=${item.proposal.id}`"
                class="link-plain text-body-2 font-weight-medium"
              >
                {{ proposalName(item.proposal) }}
              </NuxtLink>
              <span v-else class="text-body-2 font-weight-medium">
                {{ proposalName(item.proposal) }}
              </span>

              <ChipRevisionStatus
                :status="item.proposal.status"
                :derived="item.proposal.statusDerived"
                size="x-small"
              />
            </div>

            <span class="text-caption text-medium-emphasis text-no-wrap">
              {{ formatDaysAgo(item.proposal.updateTime) }}
            </span>
          </div>

          <div v-if="item.proposal.kind === 'removal'" class="text-body-2 mt-1">
            Powód usunięcia: {{ item.proposal.deleteReason || "nie podano" }}
          </div>
          <RevisionDiff
            v-else
            :changes="item.proposal.changes"
            :change-count="item.proposal.changeCount"
            :max="3"
            class="mt-1"
          />

          <!-- The reason is the whole of the answer a rejected contributor
               came here for, so it is inline text and not a tooltip. -->
          <v-alert
            v-if="item.proposal.status === 'rejected'"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-2"
            :text="
              item.proposal.rejectReason
                ? `Powód: ${item.proposal.rejectReason}`
                : proposalStatusHints.rejected
            "
          />

          <v-btn
            v-if="
              item.proposal.status === 'approved' &&
              item.proposal.published &&
              item.proposal.targetPath
            "
            size="x-small"
            variant="text"
            class="mt-2"
            :to="item.proposal.targetPath"
            :prepend-icon="mdiEarth"
          >
            Zobacz na stronie
          </v-btn>
          <div
            v-else-if="
              item.proposal.status === 'approved' && !item.proposal.published
            "
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
        v-if="truncated.proposals && anyProposals"
        class="text-caption text-medium-emphasis mt-2"
      >
        Wczytaliśmy {{ SCAN_CAP }} najnowszych zapisów na Twoim koncie - starsze
        są poza tym zestawieniem.
      </div>
      <div
        v-if="truncated.votes"
        class="text-caption text-medium-emphasis mt-2"
      >
        Wczytaliśmy {{ VOTES_CAP }} najnowszych głosów - starsze są poza tym
        zestawieniem.
      </div>

      <div v-if="anyProposals" class="text-caption text-medium-emphasis mt-3">
        Zatwierdzenie zmiany to jeszcze nie publikacja - stronę publikuje
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
import { voteCategoryConfig, voteLevelLabel } from "~/composables/votes";
import { formatDaysAgo } from "~/utils/chartTheme";
import {
  proposalStatuses,
  proposalStatusHints,
  proposalStatusLabels,
  emptyProposalCounts,
  type Proposal,
  type ProposalStatus,
} from "~~/shared/proposals";
import {
  notificationEnabled,
  notificationKinds,
} from "~~/shared/notifications";
import type {
  Interaction,
  InteractionCounts,
  InteractionFilter,
  MyInteractions,
} from "~~/server/api/interactions/mine.get";

/** What this user did on the site, and what came of it: the changes they
 * proposed, and the people they voted on.
 *
 * The proposals are the counterpart of `/admin/rewizje#kolejka`, the same rows
 * read from the other side. A contributor is otherwise told nothing at all -
 * the emails only go out on a decision, so a proposal nobody has looked at
 * leaves no trace anywhere the author can see. The votes are the way back to
 * somebody they rated a while ago.
 */

const PAGE_SIZE = 10;

/** Mirror `MINE_SCAN_CAP` and `VOTES_SCAN_CAP` on the server. Not imported
 * from there: the modules pull in firebase-admin, and only their types survive
 * the build. */
const SCAN_CAP = 300;
const VOTES_CAP = 1000;

const items = ref<Interaction[]>([]);
const counts = ref<InteractionCounts>({ ...emptyProposalCounts(), votes: 0 });
const total = ref(0);
const truncated = ref<MyInteractions["truncated"]>({
  proposals: false,
  votes: false,
});
const page = ref(0);
/** Which chip the list is narrowed to. Paging and the filter share one
 * request, so a narrowed list pages through its own matches rather than
 * through everything. */
const filter = ref<InteractionFilter>("all");
const pending = ref(false);
const loaded = ref(false);
const failed = ref(false);
const votesFailed = ref(false);

const loadPage = async (next: number) => {
  pending.value = true;
  failed.value = false;
  try {
    const response = await authRequest<MyInteractions>(
      "/api/interactions/mine",
      {
        method: "GET",
        query: { limit: PAGE_SIZE, page: next, filter: filter.value },
      },
    );
    items.value =
      next === 1 ? response.items : [...items.value, ...response.items];
    counts.value = response.counts;
    total.value = response.total;
    truncated.value = response.truncated;
    votesFailed.value = !!response.votesFailed;
    page.value = next;
    loaded.value = true;
  } catch (error) {
    console.error("Failed to load own interactions", error);
    failed.value = true;
  } finally {
    pending.value = false;
  }
};

// Client only, and deliberately: the endpoint answers a bearer token that the
// server render has no way to present.
onMounted(() => void loadPage(1));

const loadMore = () => void loadPage(page.value + 1);

type ChipKey = ProposalStatus | "votes";

/** Clicking the selected chip clears the filter, so the same chip is both the
 * way in and the way out. Always back to page one: the offsets belong to the
 * previous selection. */
const toggleFilter = (key: ChipKey) => {
  const next = key === "superseded" ? "approved" : key;
  filter.value = filter.value === next ? "all" : next;
  void loadPage(1);
};

const clearFilter = () => {
  filter.value = "all";
  void loadPage(1);
};

const hasMore = computed(() => items.value.length < total.value);
/** Read off the counts, not off `total`: `total` is the filtered set, and a
 * reader who narrowed to one chip has not stopped having the rest. */
const anyProposals = computed(() =>
  proposalStatuses.some((status) => counts.value[status] > 0),
);
const anyInteractions = computed(
  () => anyProposals.value || counts.value.votes > 0,
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
      : `${head} Decyzję zobaczysz tutaj - powiadomienia mailem masz wyłączone.`;
  }
  if (anyProposals.value)
    return "Wszystko, co zgłosiłeś, zostało rozpatrzone. Dzięki!";
  return null;
});

/** The chips count, so they read as plurals; `proposalStatusLabels` names a
 * single proposal and stays the source of the colour, so this card and the
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

/** How many rows `?filter=` would return for a status chip. See
 * `matchesStoredStatus`: approved and superseded are one stored status and
 * cannot be asked for separately. */
const selects = (status: ProposalStatus) =>
  status === "approved"
    ? counts.value.approved + counts.value.superseded
    : counts.value[status];

/** The votes first, as a kind of their own rather than a fifth state, in the
 * info ink: green and red already say what became of a proposal. A chip that
 * would select nothing is not offered - `disabled` on a v-chip is a look, not
 * a guard, so the click checks too. */
const chips = computed(() => [
  {
    key: "votes" as ChipKey,
    label: "Głosy",
    color: "ink-info",
    count: counts.value.votes,
    filterable: true,
    selectable: counts.value.votes > 0,
    active: filter.value === "votes",
    testid: "interaction-filter-votes",
  },
  ...chipOrder
    .filter((status) => status !== "superseded" || counts.value.superseded > 0)
    .map((status) => ({
      key: status as ChipKey,
      label: countLabels[status],
      color: proposalStatusLabels[status].color,
      count: counts.value[status],
      filterable: status !== "superseded",
      selectable: status !== "superseded" && selects(status) > 0,
      active: filter.value === status,
      testid: `proposal-filter-${status}`,
    })),
]);

const itemKey = (item: Interaction) =>
  item.kind === "vote" ? `vote-${item.vote.nodeId}` : item.proposal.id;

/** What to call the entry a proposal is about. A proposal against something
 * that has since been deleted keeps its row - it was still made - so it says
 * so instead of rendering as a blank line. */
const proposalName = (row: Proposal) =>
  row.targetName ?? (row.targetExists ? "Wpis bez nazwy" : "Usunięty wpis");

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

/** The colour the vote control gives the same number. */
const verdictColor = (value: number) =>
  value > 0
    ? voteCategoryConfig.interesting.color
    : voteCategoryConfig.interesting.downColor;
</script>

<style scoped>
/* The date keeps a column of its own, so it is at the right of every row; a
   long name wraps, and what follows it goes under it, in the first column. */
.interaction-row {
  align-items: baseline;
  column-gap: 16px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  position: relative;
}

.interaction-row__main {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
}

/* A vote's whole row opens the person, not only the name: on a phone the
   name alone is a 20px tall target. A proposal's row holds buttons of its
   own, so there only the name does. */
.vote-link::after {
  content: "";
  inset: 0;
  position: absolute;
}

/* The alert's own colour, rather than a second blue inside it. */
.empty-link {
  color: inherit;
}
</style>
