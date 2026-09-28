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

    <!-- On an admin's "Problemy" a problem with an open report is that
         report's row, which has no verdict buttons: the way to say it works
         is the entry its "QA: …" chip leads to. -->
    <v-alert
      v-if="counts.issue > 0"
      class="mb-4"
      type="error"
      variant="tonal"
      density="compact"
      data-issue-banner
    >
      Zgłosiłeś problem w {{ counts.issue }} wpisach.
      <template v-if="ownProblemsAsReports">
        Tutaj problem z otwartym zgłoszeniem jest tym zgłoszeniem - gdy już
        działa, zmień ocenę we wpisie, do którego prowadzi „QA: …” przy
        zgłoszeniu.
      </template>
      <template v-else>
        Wpis zostaje w zakładce „Problemy”, dopóki nie napiszesz, że już działa.
      </template>
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
           from every checker, theirs included - a problem found here reaches
           the team as a report on /admin/opinie, so that is what it is shown
           as, with the entry it is about on its line. Either way they are the
           panel's rows, dealt with here as they are there. -->
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
        <v-progress-linear
          v-if="!reportsLoadedOnce"
          indeterminate
          class="mb-4"
          data-reports-loading
        />
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
          >
            <!-- The check this list is here for, on the line and in the word
                 an entry uses for it: finding the fix working closes the
                 report, with no second trip to /admin/opinie. -->
            <template
              v-if="teamSection.id === 'fixed-reports' && !isSettled(report)"
              #actions
            >
              <v-btn
                size="small"
                variant="text"
                color="ink-success"
                :prepend-icon="mdiCheck"
                :loading="confirming === report.id"
                data-confirm-fix
                @click="confirmFix(report)"
              >
                Działa
              </v-btn>
            </template>
          </FeedbackReportRow>
        </AdminRowList>
      </template>

      <!-- Nothing at all when an admin's own problems are all in the list
           above: an empty section under it would read as a second list. -->
      <template v-if="!(ownProblemsAsReports && visibleItems.length === 0)">
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
      </template>

      <AdminRowList v-if="visibleItems.length > 0">
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
import { mdiCheck } from "@mdi/js";
import { useQaChecks } from "~/composables/qa";
import { useAuthState } from "~/composables/auth";
import { useFeedbackAdmin } from "~/composables/feedbackAdmin";
import { useQueryFilters } from "~/composables/queryFilters";
import { blocksClosing, followUpsOf } from "~~/shared/feedbackFixes";
import { isSettled } from "~~/shared/feedbackQueue";
import type { Feedback } from "~~/shared/model";
import type { QaCheckStatus, QaItem, QaItemState } from "~~/shared/qa";

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
  items: reports,
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
  writesSettled,
  snackbar: rankSnackbar,
  snackbarText: rankSnackbarText,
} = useFeedbackAdmin();

const route = useRoute();
const router = useRouter();

type Filter = "unchecked" | "issue" | "all";

/** The tab, as the url names it: `/qa?widok=problemy` is where "Problemy z
 * QA" in the toolbar's "Zespół" menu leads, and the url always says which tab
 * is showing, so that link switches back to it from this page too. The first
 * one stays out of the url. */
const TAB_PARAMS: Record<Filter, string> = {
  unchecked: "do-sprawdzenia",
  issue: "problemy",
  all: "wszystkie",
};

const { choiceFilter } = useQueryFilters();
const tabParam = choiceFilter("widok", TAB_PARAMS.unchecked);
/** Anything the url says that is not a tab is the first one. */
const filter = computed<Filter>({
  get: () =>
    (Object.keys(TAB_PARAMS) as Filter[]).find(
      (key) => TAB_PARAMS[key] === tabParam.value,
    ) ?? "unchecked",
  set: (value) => (tabParam.value = TAB_PARAMS[value]),
});

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
/** Whether the first load is over, well or not. Only that one shows as
 * loading: a later one - after a verdict here sends a report - leaves the
 * list it replaces on screen until the new one is in, rather than dropping
 * every row for a progress bar and, with them, a note half-typed in one. */
const reportsLoadedOnce = ref(false);

watch(
  () => isAdmin.value,
  (admin) => {
    if (!admin || reportsAsked.value) return;
    reportsAsked.value = true;
    loadReports().then(() => (reportsLoadedOnce.value = true));
  },
  { immediate: true },
);

/** A list in hand, and the last load did not fail. */
const reportsReady = computed(
  () => reportsLoadedOnce.value && !reportsError.value,
);

/** Open reports, in the order /admin/opinie lists them: the ones nobody has
 * placed yet, newest first, then the queue. One closed from here stays,
 * dimmed, until the next load, as it does there. */
const openReports = computed(() => [...inbox.value, ...queue.value]);

/** The ones that came from this list. */
const qaReports = computed(() =>
  openReports.value.filter((report) => !!report.context.qa),
);

/** An admin's own problems, as the reports they went out as, on "Problemy" -
 * unless the list is not there to show them, which leaves the entries to
 * stand for themselves as they do for everybody else. */
const ownProblemsAsReports = computed(
  () => isAdmin.value && filter.value === "issue" && !reportsError.value,
);

/** The entries this reader has an open report about, filed as a problem - on
 * "Problemy" that report is the entry, so the entry is not listed again. */
const reportedByMe = computed(
  () =>
    new Set(
      qaReports.value
        .filter(
          (report) =>
            report.userUid === user.value?.uid &&
            report.context.qa?.status === "issue",
        )
        .map((report) => report.context.qa!.itemId),
    ),
);

/** An admin's problems no open report stands for: the report was closed
 * while they still say the entry does not work, or it never reached the
 * team. Those stay entries, below the reports. */
const unreportedIssues = computed(() =>
  items.filter(
    (item) => stateOf(item.id) === "issue" && !reportedByMe.value.has(item.id),
  ),
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
      info: "Otwarte zgłoszenia, które zmiany w tej wersji strony mają poprawiać - wpisem z tej listy albo samą zmianą w kodzie. Sprawdź każde tam, gdzie je zgłoszono, i kliknij „Działa” - to zamyka zgłoszenie.",
      reports: fixedReports.value,
      empty: "Żadne otwarte zgłoszenie nie czeka na sprawdzenie poprawki.",
      link: undefined,
    };
  }
  if (filter.value === "issue") {
    return {
      id: "qa-reports",
      title: "Zgłoszenia z QA",
      info: "Każdy problem zgłoszony na tej liście trafia do panelu jako zgłoszenie. Tu są otwarte, od wszystkich sprawdzających - Twoje też - z wpisem, którego dotyczą. Status, notatka i kolejka działają tu tak samo jak w panelu zgłoszeń.",
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
  if (ownProblemsAsReports.value) {
    return {
      id: "my-issues",
      title: "Twoje problemy bez otwartego zgłoszenia",
      info: "Wpisy, które wciąż oceniasz jako „Coś nie działa”, choć zgłoszenie z tą oceną zostało zamknięte albo nie dotarło do zespołu. Jeśli już działa, zmień ocenę; jeśli nie, opisz, co wciąż jest nie tak.",
    };
  }
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
      info: "Wpisy bez Twojej oceny. Zostają tutaj, dopóki nie powiesz, czy działają. „Działa” przy wpisie, który poprawia zgłoszenie, zamyka też to zgłoszenie.",
    };
  }
  return null;
});

/** For an admin, "Problemy" counts what the team has to deal with and what
 * of their own is left besides - once it is known; for anybody else, the
 * entries they reported themselves. */
const problemCount = computed(() => {
  if (!isAdmin.value) return counts.value.issue;
  return reportsReady.value
    ? qaReports.value.length + unreportedIssues.value.length
    : undefined;
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

/** Nothing of an admin's own until the reports are in: listing every problem
 * first and taking most of them away a moment later would be a flicker. */
const visibleItems = computed(() => {
  if (!ownProblemsAsReports.value) {
    return items.filter((item) => matches(stateOf(item.id)));
  }
  return reportsReady.value ? unreportedIssues.value : [];
});

const emptyText = computed(
  () =>
    ({
      unchecked: "Wszystko sprawdzone. Dzięki!",
      issue: "Nie masz zgłoszonych problemów.",
      all: "Nic tu nie ma.",
    })[filter.value],
);

/** Where a link to one entry lands - the "QA: …" chip and the "Poprawka" menu
 * on /admin/opinie, Slack's "Otwórz wpis QA". The list opens on what this
 * reader has not checked, and an entry they have is not rendered under that
 * filter, so the router's own scroll to the hash finds nothing. The entry is
 * opened too: the link was followed to read it. */
async function focusHashItem() {
  const id = /^#qa-(.+)$/.exec(route.hash)?.[1];
  if (!id || !loaded.value || !items.some((item) => item.id === id)) return;
  // Not rendered is not only another tab's: on an admin's "Problemy" their own
  // problem is the report it went out as, and the entry is not listed.
  if (!visibleItems.value.some((item) => item.id === id)) {
    // Replaced rather than pushed, and with the hash kept: the link is where
    // the reader went, the tab is only in its way.
    await router.replace({
      query: { ...route.query, widok: TAB_PARAMS.all },
      hash: route.hash,
    });
  }
  openRows.add(`qa-${id}`);
  await nextTick();
  document.getElementById(`qa-${id}`)?.scrollIntoView({ block: "start" });
}

watch([loaded, () => route.hash], focusHashItem, { immediate: true });

/** Somebody else's verdicts on an entry - this reader's own is already shown
 * on the buttons, so repeating it below them says nothing. */
const otherChecks = (itemId: string) =>
  checksFor(itemId).filter((check) => check.userUid !== user.value?.uid);

/** What an admin's "Działa" did to the reports a fix is for. */
type Closing = {
  closed: number;
  /** Left open because a problem reported against the fix still is. */
  held: number;
  failed: number;
  /** The list of reports never arrived, so none could be looked at. */
  unread: boolean;
};

/** An admin's "Działa" on an entry is the check the reports it fixes were
 * waiting for, so it closes them there and then - checking a fix here and
 * closing its report again on /admin/opinie was doing the same thing twice.
 * The one exception is a report a problem reported against the fix still
 * holds open (`blocksClosing`), which is not done whatever the verdicts say.
 * Anybody else's verdict closes nothing; closing is an admin's. */
async function closeFixedBy(entry: QaItem): Promise<Closing> {
  if (!reportsReady.value) {
    return { closed: 0, held: 0, failed: 0, unread: true };
  }
  const claims = new Set(entry.fixes);
  const open = reports.value.filter(
    (report) => claims.has(report.id!) && !isSettled(report),
  );
  const held = open.filter((report) =>
    followUpsOf(report, [entry], reports.value).some(blocksClosing),
  );
  const closing = open.filter((report) => !held.includes(report));
  const results = await Promise.all(
    closing.map((report) => updateAdmin(report, { adminStatus: "resolved" })),
  );
  const closed = results.filter(Boolean).length;
  return {
    closed,
    held: held.length,
    failed: closing.length - closed,
    unread: false,
  };
}

/** "zgłoszenie", "2 zgłoszenia", "5 zgłoszeń" - after "zamknięto". */
function reportCount(n: number): string {
  if (n === 1) return "zgłoszenie";
  const few = n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14);
  return `${n} ${few ? "zgłoszenia" : "zgłoszeń"}`;
}

function closingText({ closed, held, failed, unread }: Closing): string {
  if (unread) return "zgłoszeń nie zamknięto - nie wczytała się ich lista";
  return [
    closed && `zamknięto ${reportCount(closed)}`,
    held &&
      `nie zamknięto ${held === 1 ? "zgłoszenia" : `${held} zgłoszeń`} - problem zgłoszony przy tej poprawce jest wciąż otwarty`,
    failed &&
      `nie udało się zamknąć ${failed === 1 ? "zgłoszenia" : `${failed} zgłoszeń`}`,
  ]
    .filter(Boolean)
    .join(", ");
}

/** `entry` is passed by a caller that already has it - the entry claiming a
 * report, from `fixInfo` - and otherwise looked up on this list. */
async function save(
  itemId: string,
  status: QaCheckStatus,
  feedback: string,
  entry: QaItem | undefined = items.find((item) => item.id === itemId),
) {
  savingId.value = itemId;
  try {
    const { reported, forwarded } = await saveCheck(itemId, status, feedback);
    const closing =
      status === "ok" && isAdmin.value && entry?.fixes?.length
        ? await closeFixedBy(entry)
        : null;
    // Four outcomes worth telling apart: the tick alone, the same verdict
    // saved again with nothing new to send, the tick plus a report that
    // reached the team, and the tick with a report that did not. The last one
    // is not an error - the verdict is saved either way - but somebody who
    // wrote out a problem should know it is still only here.
    const verdict = !reported
      ? status === "ok"
        ? "Zapisane: działa"
        : "Zapisane. Bez zmian, więc nie wysłano ponownie."
      : forwarded
        ? status === "ok"
          ? "Zapisane i wysłane do zespołu"
          : "Zgłoszone - problem trafił do zespołu"
        : "Zapisane, ale nie udało się wysłać do zespołu";
    const closingSaid = closing ? closingText(closing) : "";
    snackbarText.value = closingSaid ? `${verdict} · ${closingSaid}` : verdict;
    snackbarColor.value =
      (forwarded || !reported) &&
      !closing?.failed &&
      !closing?.held &&
      !closing?.unread
        ? "ink-success"
        : "ink-warning";
    snackbar.value = true;
    // The report just sent is on the team's list now, and on "Problemy" it is
    // what stands for this entry - so an admin's copy of the list is read
    // again rather than leaving the entry to look like a problem the team was
    // never told about. After the triage still being written, as on
    // /admin/opinie.
    if (forwarded && isAdmin.value) {
      writesSettled().then(() => loadReports());
    }
  } catch (error) {
    console.error("Nie udało się zapisać oceny QA", error);
    snackbarText.value = "Nie udało się zapisać";
    snackbarColor.value = "error";
    snackbar.value = true;
  } finally {
    savingId.value = null;
  }
}

/** Which report's "Działa" is being written, for its spinner. */
const confirming = ref<string | null>(null);

/** "Działa" on a report this build says it fixes. Where a QA entry claims it,
 * that is the entry's verdict - the same click as on the entry, so the entry
 * leaves this reader's list as well, and it closes whatever the entry fixes.
 * A change with no entry has no verdict to take, and closes the report. */
async function confirmFix(report: Feedback) {
  confirming.value = report.id!;
  try {
    const entry = fixInfo.value.get(report.id!)?.entries[0];
    if (entry) {
      await save(entry.id, "ok", "", entry);
      return;
    }
    const closed = await updateAdmin(report, { adminStatus: "resolved" });
    snackbarText.value = closed
      ? "Zamknięte: poprawka działa"
      : "Nie udało się zamknąć zgłoszenia";
    snackbarColor.value = closed ? "ink-success" : "error";
    snackbar.value = true;
  } finally {
    confirming.value = null;
  }
}
</script>
