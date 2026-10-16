<template>
  <v-card
    v-if="rows.length > 0"
    variant="outlined"
    class="mt-4"
    data-testid="node-proposals"
  >
    <v-card-title class="text-subtitle-1">
      Twoje propozycje zmian do tej strony
    </v-card-title>
    <v-card-subtitle class="text-wrap">{{ subtitle }}</v-card-subtitle>

    <v-card-text>
      <template v-for="(row, index) in rows" :key="row.id">
        <v-divider v-if="index > 0" />
        <div class="py-2">
          <div class="d-flex align-center flex-wrap ga-2">
            <ChipRevisionStatus
              :status="row.status"
              :derived="row.statusDerived"
              size="x-small"
            />
            <!-- The whole point of the card: `revisionId` renders this page
                 from the proposal, so the author can read their own version
                 instead of guessing whether it arrived. -->
            <NuxtLink
              :to="previewTo(row)"
              class="text-body-2"
              :data-testid="`node-proposal-preview-${row.id}`"
            >
              Podgląd tej wersji
            </NuxtLink>
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

          <!-- Same reasoning as on /profil: the reason is the whole of the
               answer a rejected contributor is owed, so it is inline text. -->
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
        </div>
      </template>

      <div class="d-flex flex-wrap ga-2 mt-1">
        <!-- Not admin-gated: the page behind it is `middleware: 'auth'`, and
             it is where somebody can see their proposal next to the version
             the site is serving. -->
        <v-btn
          size="small"
          variant="text"
          :prepend-icon="mdiHistory"
          :to="`/admin/rewizje/${nodeId}`"
          data-testid="node-proposals-history"
        >
          Historia zmian tej strony
        </v-btn>
        <v-btn size="small" variant="text" to="/profil">
          Wszystkie Twoje propozycje
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
/** What the signed-in reader has proposed for the entry they are looking at.
 *
 * `/profil` has said this since review shipped, and the entry's own page said
 * nothing at all: a contributor pressed "Zaproponuj zmianę", the dialog closed,
 * the page went on showing the stored version, and there was no way to tell a
 * proposal that was waiting from one that had never been sent. One of them
 * filed the same correction to a company several times over. So the answer is
 * put where the question is asked.
 *
 * Own proposals only. Everybody else's are on `/admin/rewizje/[id]`, which the
 * button at the bottom leads to - showing a page's unreviewed proposals to
 * whoever happens to be reading it would publish text nobody has looked at.
 */
import { computed, onMounted, ref, watch } from "vue";
import { mdiHistory } from "@mdi/js";
import { useRoute } from "vue-router";
import { authRequest, useAuthState } from "~/composables/auth";
import { polishCounting } from "~/composables/polish";
import { formatDaysAgo } from "~/utils/chartTheme";
import { proposalStatusHints, type Proposal } from "~~/shared/proposals";
import type { MyProposals } from "~~/server/api/revisions/mine.get";

const props = defineProps<{ nodeId: string }>();

/** One entry's worth, so the cap is about how many corrections one person can
 * have filed against one page rather than about paging. */
const LIMIT = 20;

const rows = ref<Proposal[]>([]);
const { user } = useAuthState();
const route = useRoute();

const load = async () => {
  if (!user.value || !props.nodeId) {
    rows.value = [];
    return;
  }
  try {
    const response = await authRequest<MyProposals>("/api/revisions/mine", {
      method: "GET",
      query: {
        limit: LIMIT,
        page: 1,
        status: "all",
        nodeId: props.nodeId,
      },
    });
    rows.value = response.revisions;
  } catch (error) {
    // A card that cannot load is a card that is not there. The page it sits on
    // is about the company, and an error box about the proposal machinery
    // would be the loudest thing on it.
    console.error("Failed to load own proposals for node", error);
    rows.value = [];
  }
};

// Client only: the endpoint answers a bearer token, which the server render
// has no way to present. Re-read when the reader signs in, which is how they
// get here after the login dialog that gates "Zaproponuj zmianę".
onMounted(() => void load());
watch(
  () => [props.nodeId, !!user.value],
  () => void load(),
);

defineExpose({ refresh: load });

const pending = computed(
  () => rows.value.filter((row) => row.status === "pending").length,
);

const subtitle = computed(() =>
  pending.value > 0
    ? `${polishCounting(pending.value, "propozycja czeka", "propozycje czekają", "propozycji czeka")} na redakcję - do tego czasu strona pokazuje wersję sprzed zmiany.`
    : "Redakcja rozpatrzyła wszystko, co zgłosiłeś do tej strony.",
);

/** Stays on the page the reader is already on, so the preview of their own
 * version is one click away and the back button undoes it. */
const previewTo = (row: Proposal) =>
  `${row.targetPath ?? route.path}?revisionId=${row.id}`;
</script>
