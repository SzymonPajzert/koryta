<template>
  <!-- `data-qa-loaded` is what the e2e spec waits on: the verdicts arriving is
       both the page becoming truthful and the proof that it has hydrated, so
       a filter clicked before that would silently do nothing. -->
  <div class="w-100 pa-2" :data-qa-loaded="loaded">
    <h1 class="text-h5 text-sm-h4 mb-2">QA - zmiany do sprawdzenia</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Lista zmian na stronie, od najnowszej. Przejdź krokami z wpisu, a potem
      powiedz, czy działa - i co poprawić. Liczy się Twoje sprawdzenie: wpis
      przechodzi do sprawdzonych dopiero, gdy Ty go ocenisz, nawet jeśli ktoś
      inny już go widział. Twoje uwagi widzą inni zalogowani, a zgłoszony
      problem trafia do zespołu tą samą drogą, co przycisk „Zgłoś” - nic nie
      trzeba pisać drugi raz.
    </p>

    <v-alert
      v-if="counts.issue > 0"
      class="mb-4"
      type="error"
      variant="tonal"
      density="compact"
    >
      Zgłosiłeś problem w {{ counts.issue }} wpisach. Wpis zostaje w zakładce
      „Problemy”, dopóki nie napiszesz, że już działa.
      <template v-if="settledCount > 0">
        W {{ settledCount }} z nich admin uznał sprawę za zamkniętą - zajrzyj i
        zdecyduj, czy się zgadzasz.
      </template>
    </v-alert>

    <v-btn-toggle
      v-model="filter"
      class="mb-4"
      color="primary"
      density="compact"
      variant="outlined"
      mandatory
    >
      <v-btn value="unchecked">
        Do sprawdzenia
        <v-badge
          v-if="counts.unchecked > 0"
          class="ms-2"
          inline
          color="grey"
          :content="counts.unchecked"
        />
      </v-btn>
      <v-btn value="issue">
        Problemy
        <v-badge
          v-if="counts.issue > 0"
          class="ms-2"
          inline
          color="error"
          :content="counts.issue"
        />
      </v-btn>
      <v-btn value="all">Wszystkie</v-btn>
    </v-btn-toggle>

    <v-progress-linear v-if="!loaded" indeterminate class="mb-4" />

    <v-alert
      v-if="loaded && visibleItems.length === 0"
      type="success"
      variant="tonal"
      density="compact"
    >
      {{
        filter === "unchecked"
          ? "Wszystko sprawdzone. Dzięki!"
          : "Nic tu nie ma."
      }}
    </v-alert>

    <QaItemCard
      v-for="item in loaded ? visibleItems : []"
      :key="item.id"
      :item="item"
      :state="stateOf(item.id)"
      :my-check="myCheck(item.id)"
      :other-checks="otherChecks(item.id)"
      :reported-by-others="reportedByOthers(item.id)"
      :admin-resolution="adminResolution(item.id)"
      :awaiting-acceptance="awaitingAcceptance(item.id)"
      :saving="savingId === item.id"
      @save="(status, feedback) => save(item.id, status, feedback)"
      @accept="accept(item.id)"
    />

    <v-snackbar v-model="snackbar" :timeout="3000" :color="snackbarColor">
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from "vue";
import { useQaChecks } from "~/composables/qa";
import { useAuthState } from "~/composables/auth";
import type { QaCheckStatus, QaItemState } from "~~/shared/qa";

definePageMeta({
  middleware: "auth",
  // Nothing here is for a reader who is not signed in, and the entries name
  // changes before anyone has confirmed they work.
  robots: false,
});

useHead({ title: "QA - zmiany do sprawdzenia" });

const { user } = useAuthState();
const {
  items,
  load,
  loaded,
  stateOf,
  counts,
  reportedByOthers,
  checksFor,
  myCheck,
  saveCheck,
  loadAdminResolutions,
  adminResolution,
  awaitingAcceptance,
  acceptResolution,
} = useQaChecks();

type Filter = "unchecked" | "issue" | "all";
const filter = ref<Filter>("unchecked");
const savingId = ref<string | null>(null);
const snackbar = ref(false);
const snackbarText = ref("");
const snackbarColor = ref("success");

// Two reads, not one: `load` is the verdicts the whole page is built on, and
// this is what the team did with the reports those verdicts filed. They fail
// independently on purpose - see `loadAdminResolutions`.
onMounted(() => {
  load();
  loadAdminResolutions();
});

/** How many of this reader's reported problems an admin has already closed.
 * Counted over every entry rather than the visible ones: the alert sits above
 * the filter and is the reason to go and look at "Problemy". */
const settledCount = computed(
  () => items.filter((item) => awaitingAcceptance(item.id)).length,
);

const matches = (state: QaItemState) =>
  filter.value === "all" ||
  (filter.value === "issue" ? state === "issue" : state === "unchecked");

const visibleItems = computed(() =>
  items.filter((item) => matches(stateOf(item.id))),
);

/** Somebody else's verdicts on an entry - this reader's own is already shown
 * on the buttons, so repeating it below them says nothing. */
const otherChecks = (itemId: string) =>
  checksFor(itemId).filter((check) => check.userUid !== user.value?.uid);

/** Take the team's word that a reported problem is dealt with.
 *
 * The entry goes back to "Do sprawdzenia" rather than to "Sprawdzone", which
 * is what the snackbar says: accepting a closure is not the same as having
 * re-checked it, and only the reader can do the second one.
 */
async function accept(itemId: string) {
  savingId.value = itemId;
  try {
    await acceptResolution(itemId);
    snackbarText.value = "Przyjęte - wpis wraca do sprawdzenia";
    snackbarColor.value = "success";
  } catch (error) {
    console.error("Nie udało się przyjąć rozstrzygnięcia QA", error);
    snackbarText.value = "Nie udało się zapisać";
    snackbarColor.value = "error";
  } finally {
    snackbar.value = true;
    savingId.value = null;
  }
}

async function save(itemId: string, status: QaCheckStatus, feedback: string) {
  savingId.value = itemId;
  try {
    const { reported, forwarded } = await saveCheck(itemId, status, feedback);
    // Three outcomes worth telling apart: the tick alone, the tick plus a
    // report that reached the team, and the tick with a report that did not.
    // The last one is not an error - the verdict is saved either way - but
    // somebody who wrote out a problem should know it is still only here.
    snackbarText.value = !reported
      ? "Zapisane: działa"
      : forwarded
        ? status === "ok"
          ? "Zapisane i wysłane do zespołu"
          : "Zgłoszone - problem trafił do zespołu"
        : "Zapisane, ale nie udało się wysłać do zespołu";
    snackbarColor.value = forwarded || !reported ? "success" : "warning";
    snackbar.value = true;
  } catch (error) {
    console.error("Nie udało się zapisać oceny QA", error);
    snackbarText.value = "Nie udało się zapisać";
    snackbarColor.value = "error";
    snackbar.value = true;
  } finally {
    savingId.value = null;
  }
}
</script>
