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
    </v-alert>

    <FeedbackFilterChips
      v-model="filter"
      :options="filterOptions"
      class="mb-4"
    />

    <v-progress-linear v-if="!loaded" indeterminate class="mb-4" />

    <template v-else>
      <!-- An admin gets the team's side of the tab above their own: on "Do
           sprawdzenia" the open reports this build says it fixes, to check
           and close; on "Problemy" every open report sent from this list,
           from every checker - a problem found here reaches the team as a
           report on /admin/opinie, and this makes "Problemy" one list of what
           is wrong rather than two to read side by side. Either way they are
           the panel's rows, dealt with here as they are there. -->
      <template v-if="teamSection">
        <AdminSectionHead
          :title="teamSection.title"
          :count="reportsReady ? teamSection.reports.length : undefined"
          :info="teamSection.info"
          :data-section="teamSection.id"
        >
          <NuxtLink
            v-if="teamSection.link"
            :to="teamSection.link.to"
            class="text-body-2"
          >
            {{ teamSection.link.text }}
          </NuxtLink>
        </AdminSectionHead>
        <v-progress-linear v-if="reportsPending" indeterminate class="mb-4" />
        <v-alert
          v-else-if="reportsError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-6"
        >
          {{ reportsError }}
        </v-alert>
        <p
          v-else-if="teamSection.reports.length === 0"
          class="text-body-2 text-medium-emphasis mb-6"
        >
          {{ teamSection.empty }}
        </p>
        <AdminRowList v-else class="mb-6">
          <FeedbackReportRow
            v-for="report in teamSection.reports"
            :key="report.id"
            :item="report"
            :position="positions.get(report.id!)"
            :fix="fixInfo.get(report.id!)"
            :fix-targets="fixTargets.get(report.id!)"
            :can-queue="sectionOf(report) === 'inbox'"
            :saving="reportSaving[report.id!]"
            report-page="/admin/opinie"
            :expanded="openRows.has(`fb-${report.id}`)"
            @update:expanded="(open) => setOpen(`fb-${report.id}`, open)"
            @queue="moveTo(report, queue.length)"
            @status="(adminStatus) => updateAdmin(report, { adminStatus })"
            @draft="(note) => (draftNotes[report.id!] = note)"
            @save-note="saveNote(report)"
          />
        </AdminRowList>
      </template>

      <AdminSectionHead
        v-if="ownSection"
        :title="ownSection.title"
        :count="visibleItems.length"
        :info="ownSection.info"
        :data-section="ownSection.id"
      />

      <v-alert
        v-if="visibleItems.length === 0"
        type="success"
        color="ink-success"
        variant="tonal"
        density="compact"
      >
        {{ emptyText }}
      </v-alert>

      <AdminRowList v-else>
        <QaItemRow
          v-for="item in visibleItems"
          :key="item.id"
          :item="item"
          :state="stateOf(item.id)"
          :my-check="myCheck(item.id)"
          :other-checks="otherChecks(item.id)"
          :reported-by-others="reportedByOthers(item.id)"
          :saving="savingId === item.id"
          :report-ids="isAdmin ? item.fixes : undefined"
          :expanded="openRows.has(`qa-${item.id}`)"
          @update:expanded="(open) => setOpen(`qa-${item.id}`, open)"
          @save="(status, feedback) => save(item.id, status, feedback)"
        />
      </AdminRowList>
    </template>

    <v-snackbar v-model="snackbar" :timeout="3000" :color="snackbarColor">
      {{ snackbarText }}
    </v-snackbar>
    <v-snackbar v-model="rankSnackbar" :timeout="4000" color="error">
      {{ rankSnackbarText }}
    </v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useQaChecks } from "~/composables/qa";
import { useAuthState } from "~/composables/auth";
import { useFeedbackAdmin } from "~/composables/feedbackAdmin";
import type { QaCheckStatus, QaItemState } from "~~/shared/qa";

definePageMeta({
  middleware: "auth",
  // Nothing here is for a reader who is not signed in, and the entries name
  // changes before anyone has confirmed they work.
  robots: false,
});

useHead({ title: "QA - zmiany do sprawdzenia" });

const { user, isAdmin } = useAuthState();
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
} = useQaChecks();

/** /admin/opinie's reports, for an admin: the ones this build says it fixes,
 * on the first tab, and the ones sent from this list, on "Problemy". The list
 * is admin-only, so nobody else ever asks for it. */
const {
  pending: reportsPending,
  loadError: reportsError,
  load: loadReports,
  sectionOf,
  inbox,
  queue,
  positions,
  fixInfo,
  fixTargets,
  saving: reportSaving,
  draftNotes,
  updateAdmin,
  saveNote,
  moveTo,
  snackbar: rankSnackbar,
  snackbarText: rankSnackbarText,
} = useFeedbackAdmin();

type Filter = "unchecked" | "issue" | "all";
const filter = ref<Filter>("unchecked");
const savingId = ref<string | null>(null);
const snackbar = ref(false);
const snackbarText = ref("");
/** Ink rather than Vuetify's own colours: the snackbar is white text on this
 * fill, and those are too pale to carry it. */
const snackbarColor = ref("ink-success");
/** Open rows, entries (`qa-<id>`) and reports (`fb-<id>`) alike - held here
 * so a link to an entry can open it. */
const openRows = reactive(new Set<string>());

const setOpen = (rowId: string, open: boolean) =>
  open ? openRows.add(rowId) : openRows.delete(rowId);

onMounted(() => load());

/** Asked for as soon as the page knows it has an admin, since the tab it opens
 * on lists some of them; and not again on the way between tabs: status and
 * queue changes made here are applied in place, as on /admin/opinie. */
const reportsAsked = ref(false);

watch(
  () => isAdmin.value,
  (admin) => {
    if (!admin || reportsAsked.value) return;
    reportsAsked.value = true;
    loadReports();
  },
  { immediate: true },
);

const reportsReady = computed(
  () => reportsAsked.value && !reportsPending.value && !reportsError.value,
);

/** Open reports, in the order /admin/opinie lists them: the ones nobody has
 * placed yet, newest first, then the queue. One closed from here stays,
 * dimmed, until the next load, as it does there. */
const openReports = computed(() => [...inbox.value, ...queue.value]);

/** The ones that came from this list. */
const qaReports = computed(() =>
  openReports.value.filter((report) => !!report.context.qa),
);

/** The ones this build says it fixes: named in a QA entry's `fixes`, or by a
 * change with no entry of its own (`shared/reportFixes.ts`). A branch's
 * claims show on that branch's /qa, and here once it is rolled out. */
const fixedReports = computed(() =>
  openReports.value.filter((report) => fixInfo.value.has(report.id!)),
);

/** The admin's list above the tab's own entries, if the tab has one. */
const teamSection = computed(() => {
  if (!isAdmin.value) return null;
  if (filter.value === "unchecked") {
    return {
      id: "fixed-reports",
      title: "Zgłoszenia do zamknięcia",
      info: "Otwarte zgłoszenia, które zmiany w tej wersji strony mają poprawiać - wpisem z tej listy albo samą zmianą w kodzie. Sprawdź każde tam, gdzie je zgłoszono, i zamknij, jeśli działa.",
      reports: fixedReports.value,
      empty: "Żadne otwarte zgłoszenie nie czeka na sprawdzenie poprawki.",
      link: undefined,
    };
  }
  if (filter.value === "issue") {
    return {
      id: "qa-reports",
      title: "Zgłoszenia z QA",
      info: "Otwarte zgłoszenia wysłane z tej listy, od wszystkich sprawdzających. Status, notatka i kolejka działają tu tak samo jak w panelu zgłoszeń.",
      reports: qaReports.value,
      empty: "Nie ma otwartych zgłoszeń z QA.",
      link: {
        to: "/admin/opinie?zrodlo=qa",
        text: "Wszystkie w panelu zgłoszeń",
      },
    };
  }
  return null;
});

/** The head over the reader's own entries: wherever an admin's list sits
 * above them, and on "Problemy" for everybody. */
const ownSection = computed(() => {
  if (filter.value === "issue") {
    return {
      id: "my-issues",
      title: "Twoje zgłoszone problemy",
      info: "Wpisy z Twoją oceną „Coś nie działa”. Zostają tutaj, dopóki nie zmienisz jej na „Działa”.",
    };
  }
  if (filter.value === "unchecked" && isAdmin.value) {
    return {
      id: "my-unchecked",
      title: "Twoje wpisy do sprawdzenia",
      info: "Wpisy bez Twojej oceny. Zostają tutaj, dopóki nie powiesz, czy działają.",
    };
  }
  return null;
});

/** For an admin, "Problemy" counts what the team has to deal with - once it
 * is known; for anybody else, the entries they reported themselves. */
const problemCount = computed(() => {
  if (!isAdmin.value) return counts.value.issue;
  return reportsReady.value ? qaReports.value.length : undefined;
});

/** A count only above zero, as the badges these replaced had it. */
const filterOptions = computed(
  (): {
    value: Filter;
    title: string;
    count?: number;
    tone?: "danger";
  }[] => [
    {
      value: "unchecked",
      title: "Do sprawdzenia",
      count: counts.value.unchecked || undefined,
    },
    {
      value: "issue",
      title: "Problemy",
      count: problemCount.value || undefined,
      tone: "danger",
    },
    { value: "all", title: "Wszystkie" },
  ],
);

const matches = (state: QaItemState) =>
  filter.value === "all" ||
  (filter.value === "issue" ? state === "issue" : state === "unchecked");

const visibleItems = computed(() =>
  items.filter((item) => matches(stateOf(item.id))),
);

const emptyText = computed(
  () =>
    ({
      unchecked: "Wszystko sprawdzone. Dzięki!",
      issue: "Nie masz zgłoszonych problemów.",
      all: "Nic tu nie ma.",
    })[filter.value],
);

const route = useRoute();

/** Where a link to one entry lands - the "QA: …" chip and the "Poprawka" menu
 * on /admin/opinie, Slack's "Otwórz wpis QA". The list opens on what this
 * reader has not checked, and an entry they have is not rendered under that
 * filter, so the router's own scroll to the hash finds nothing. The entry is
 * opened too: the link was followed to read it. */
async function focusHashItem() {
  const id = /^#qa-(.+)$/.exec(route.hash)?.[1];
  if (!id || !loaded.value || !items.some((item) => item.id === id)) return;
  if (!matches(stateOf(id))) filter.value = "all";
  openRows.add(`qa-${id}`);
  await nextTick();
  document.getElementById(`qa-${id}`)?.scrollIntoView({ block: "start" });
}

watch([loaded, () => route.hash], focusHashItem, { immediate: true });

/** Somebody else's verdicts on an entry - this reader's own is already shown
 * on the buttons, so repeating it below them says nothing. */
const otherChecks = (itemId: string) =>
  checksFor(itemId).filter((check) => check.userUid !== user.value?.uid);

async function save(itemId: string, status: QaCheckStatus, feedback: string) {
  savingId.value = itemId;
  try {
    const { reported, forwarded } = await saveCheck(itemId, status, feedback);
    // Four outcomes worth telling apart: the tick alone, the same verdict
    // saved again with nothing new to send, the tick plus a report that
    // reached the team, and the tick with a report that did not. The last one
    // is not an error - the verdict is saved either way - but somebody who
    // wrote out a problem should know it is still only here.
    snackbarText.value = !reported
      ? status === "ok"
        ? "Zapisane: działa"
        : "Zapisane. Bez zmian, więc nie wysłano ponownie."
      : forwarded
        ? status === "ok"
          ? "Zapisane i wysłane do zespołu"
          : "Zgłoszone - problem trafił do zespołu"
        : "Zapisane, ale nie udało się wysłać do zespołu";
    snackbarColor.value =
      forwarded || !reported ? "ink-success" : "ink-warning";
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
