<template>
  <div class="w-100 doverview" data-testid="declarations-overview">
    <!-- The approved admin head (2026-10-16): the title at the public pages'
         40/700, one sentence under it, the method behind the (i), the page's
         own button on the right. `AdminPageHead` carries it on the redesign
         branch; until that lands it is written out here. -->
    <header class="dhead">
      <div class="dhead__text">
        <div class="dhead__title">
          <h1>Oświadczenia majątkowe</h1>
          <InfoBubble label="Oświadczenia majątkowe">{{ headInfo }}</InfoBubble>
        </div>
        <p class="dhead__lead">
          Jak daleko doszło przepisywanie dat urodzenia z oświadczeń radnych i
          co czeka na administratora.
        </p>
      </div>
      <div class="dhead__actions">
        <span
          v-if="overview"
          class="text-caption text-medium-emphasis"
          data-overview-at
        >
          Stan na {{ shortWarsawTime(overview.at, now) }}
        </span>
        <v-btn
          variant="outlined"
          size="small"
          :prepend-icon="mdiRefresh"
          :loading="loading"
          data-overview-refresh
          @click="load"
        >
          Odśwież
        </v-btn>
      </div>
    </header>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-6"
      data-overview-error
    >
      {{ error }}
      <template #append>
        <v-btn variant="text" size="small" :disabled="loading" @click="load">
          Spróbuj ponownie
        </v-btn>
      </template>
    </v-alert>

    <!-- Before the first answer: the shape of the head, not an empty page
         that reads as "nothing found". -->
    <div v-if="!overview && loading" class="dloading" data-overview-loading>
      <v-skeleton-loader type="heading, text@2" class="mb-6" />
      <v-skeleton-loader type="list-item-two-line@3" />
    </div>

    <!-- Where everybody a declaration can publish stands, in people: the
         job's nightly count, apart from the overview's own live one. -->
    <AdminDeclarationsPeople v-if="peopleSnapshot" :people="peopleSnapshot" />

    <template v-if="overview">
      <!-- The whole run by state first, then the chain that walks through it
           stage by stage (round bip-admin-r2). -->
      <div class="dprogress">
        <AdminDeclarationsStates :overview="overview" />
        <AdminDeclarationsChain :overview="overview" :publish="publishQueued" />
      </div>

      <!-- Before the first upload the head still stands, at nought and with
           the limit the automation will publish at; the lists have nothing
           to say yet. -->
      <p v-if="nothingYet" class="k-note dsection" data-overview-empty>
        Zadanie jeszcze niczego nie przesłało. Listy do przejrzenia pojawią się
        tu po pierwszej przesyłce.
      </p>

      <template v-else>
        <!-- The work, in the order a reading goes wrong: readers who cannot
             agree, an agreement the page contradicts, a match the automation
             would not publish.

             Each list's test id marks its rows, not the section with its
             head, so a button looked for inside it is a row's and never the
             head's (i). -->
        <section id="sporne" class="dsection">
          <AdminSectionHead
            title="Sporne wycinki"
            :count="overview.lists.disputed.length"
            :info="`Czytelnicy nie zgodzili się co do daty. Po ${DISPUTED_AFTER} odpowiedziach bez zgody wycinek przestaje trafiać do czytelników i czeka tutaj: obejrzyj go i przyjmij datę albo uznaj za nieczytelny.`"
          />
          <div data-testid="declarations-disputed">
            <AdminRowList v-if="overview.lists.disputed.length">
              <AdminDeclarationsReviewRow
                v-for="row in overview.lists.disputed"
                :key="row.id"
                kind="disputed"
                :row="row"
                :now="now"
                :busy="busy.get(row.id) ?? null"
                :expanded="openRows.has(`disputed:${row.id}`)"
                @update:expanded="
                  (open: boolean) => setOpen(`disputed:${row.id}`, open)
                "
                @settle="(value: string) => decide(row, 'settle', value)"
                @unreadable="decide(row, 'unreadable')"
                @withdraw="decide(row, 'withdraw')"
              />
            </AdminRowList>
            <p v-else class="dsection__empty">Żadnego sporu.</p>
          </div>
        </section>

        <section id="inna-data" class="dsection">
          <AdminSectionHead
            title="Inna data niż na stronie"
            :count="overview.lists.different.length"
            info="Data z wycinka nie zgadza się z datą na stronie osoby. Tę datę uzgodnili czytelnicy, odczytało zadanie albo przyjął administrator; kto, widać w otwartym wierszu. Jedna cyfra różnicy to zwykle źle odczytany wycinek albo literówka na stronie; inny rok to częściej oświadczenie innej osoby, i wtedy wycinek się wycofuje. Przyjęta tu data, która dalej różni się od strony, wraca na tę listę, a szkic z tą samą datą trafia do sekcji „Wstrzymane publikacje”."
          />
          <div data-testid="declarations-different">
            <AdminRowList v-if="overview.lists.different.length">
              <AdminDeclarationsReviewRow
                v-for="row in overview.lists.different"
                :key="row.id"
                kind="different"
                :row="row"
                :now="now"
                :busy="busy.get(row.id) ?? null"
                :expanded="openRows.has(`different:${row.id}`)"
                @update:expanded="
                  (open: boolean) => setOpen(`different:${row.id}`, open)
                "
                @settle="(value: string) => decide(row, 'settle', value)"
                @unreadable="decide(row, 'unreadable')"
                @withdraw="decide(row, 'withdraw')"
              />
            </AdminRowList>
            <p v-else class="dsection__empty">
              Każdy odczyt zgadza się z datą na stronie.
            </p>
          </div>
        </section>

        <section id="wstrzymane" class="dsection">
          <AdminSectionHead
            title="Wstrzymane publikacje"
            :count="
              formatCount(
                heldView === 'aside'
                  ? overview.publications.setAside
                  : overview.publications.held,
              )
            "
            :info="heldInfo"
          >
            <!-- TEMP(wariant): B holds both lists in one section. -->
            <v-btn-toggle
              v-if="wariant === 'b'"
              v-model="heldView"
              mandatory
              density="compact"
              variant="outlined"
              divided
              class="dheld__view"
              data-held-view
            >
              <v-btn value="waiting" size="small">
                Do decyzji ({{ overview.publications.held }})
              </v-btn>
              <v-btn value="aside" size="small">
                Nie do publikacji ({{ overview.publications.setAside }})
              </v-btn>
            </v-btn-toggle>
            <v-select
              v-if="reasonOptions.length > 2 && heldView === 'waiting'"
              v-model="heldReason"
              :items="reasonOptions"
              label="Powód"
              density="compact"
              variant="outlined"
              hide-details
              class="dheld__reason"
              data-held-reason
            />
            <AdminDeclarationsShowAll
              v-model="showAllHeld"
              :total="heldRows.length"
              :limit="HELD_LIMIT"
            />
          </AdminSectionHead>
          <div data-testid="declarations-held">
            <AdminRowList v-if="heldShown.length">
              <AdminDeclarationsPublicationRow
                v-for="row in heldShown"
                :key="row.personId"
                :row="row"
                :now="now"
                :busy="holdBusy.get(row.personId) ?? null"
                :crop-busy="(id: string) => busy.get(id) ?? null"
                :expanded="openRows.has(`held:${row.personId}`)"
                @update:expanded="
                  (open: boolean) => setOpen(`held:${row.personId}`, open)
                "
                @publish="openPublish(row)"
                @recheck="decideHold(row, 'recheck')"
                @decline="decideHold(row, 'decline')"
                @restore="decideHold(row, 'restore')"
                @crop="decide"
              />
            </AdminRowList>
            <p v-else class="dsection__empty">Nic nie jest wstrzymane.</p>
          </div>
        </section>

        <!-- TEMP(wariant): A gives them a section of their own. -->
        <section v-if="wariant === 'a'" id="nie-do-publikacji" class="dsection">
          <AdminSectionHead
            title="Nie do publikacji"
            :count="formatCount(overview.publications.setAside)"
            info="Te osoby nie wyjdą i nic tu nie czeka na decyzję. Na ich stronach nie ma płatnego stanowiska w instytucji publicznej, a bez niego automat nikogo nie publikuje, albo administrator zdecydował, że ich nie publikujemy. To, czy stanowisko jest, czytamy ze strony przy każdym otwarciu: gdy się pojawi, osoba sama wraca na listę wstrzymanych."
          >
            <AdminDeclarationsShowAll
              v-model="showAllAside"
              :total="overview.lists.setAside.length"
              :limit="ASIDE_LIMIT"
            />
          </AdminSectionHead>
          <div data-testid="declarations-set-aside">
            <AdminRowList v-if="asideShown.length">
              <AdminDeclarationsPublicationRow
                v-for="row in asideShown"
                :key="row.personId"
                :row="row"
                :now="now"
                :busy="holdBusy.get(row.personId) ?? null"
                :expanded="openRows.has(`aside:${row.personId}`)"
                @update:expanded="
                  (open: boolean) => setOpen(`aside:${row.personId}`, open)
                "
                @restore="decideHold(row, 'restore')"
              />
            </AdminRowList>
            <p v-else class="dsection__empty">
              Każda wstrzymana osoba ma jeszcze szansę na publikację.
            </p>
          </div>
        </section>

        <section class="dsection">
          <AdminSectionHead
            title="Opublikowane ostatnio"
            :count="overview.lists.recent.length"
            info="Strony, które opublikował automat albo administrator przyciskiem „Opublikuj z kolejki”, razem z zatrudnieniami w KRS i wyborami w regionie z oświadczenia; kto, widać w otwartym wierszu. Każda ma na sobie notkę z linkiem do oświadczenia, dopóki jego odczyt potwierdza datę urodzenia na stronie."
          >
            <AdminDeclarationsShowAll
              v-model="showAllRecent"
              :total="overview.lists.recent.length"
              :limit="RECENT_LIMIT"
            />
          </AdminSectionHead>
          <div data-testid="declarations-recent">
            <AdminRowList v-if="recentShown.length">
              <AdminDeclarationsPublicationRow
                v-for="row in recentShown"
                :key="row.personId"
                :row="row"
                :now="now"
                :expanded="openRows.has(`recent:${row.personId}`)"
                @update:expanded="
                  (open: boolean) => setOpen(`recent:${row.personId}`, open)
                "
              />
            </AdminRowList>
            <p v-else class="dsection__empty">
              Jeszcze nikogo nie opublikowano.
            </p>
          </div>
        </section>

        <!-- Why the run stopped short, under the work: what an admin fixes
             is above, this is what the job's author fixes. -->
        <section
          id="nie-znaleziono"
          class="dsection"
          data-testid="declarations-not-found"
        >
          <AdminSectionHead
            title="Czego nie znaleziono"
            info="Dlaczego zadanie nie znalazło oświadczenia dla kandydatury albo nie wycięło z pliku linii z datą. Kody pochodzą z zadania; nieznany kod widać jako kod."
          />
          <AdminDeclarationsReasons
            :not-found="overview.candidacies.notFound"
            :failed="overview.extracts.failed"
          />
        </section>

        <section class="dsection" data-testid="declarations-readings">
          <AdminDeclarationsReadings
            :days="overview.readers.days"
            :answers="overview.readers.answers"
            :readers="overview.readers.readers"
            :loading="loading"
          />
        </section>

        <section class="dsection" data-testid="declarations-runs">
          <AdminSectionHead
            title="Przesyłki"
            :count="runCount"
            info="Co przysłało zadanie, od najnowszego: wersja cięcia, która je zrobiła, i ile oświadczeń przyniosło. Po wersji da się znaleźć i przysłać jeszcze raz złą partię."
          />
          <AdminDeclarationsRuns :runs="overview.runs" :now="now" />
        </section>
      </template>
    </template>

    <!-- One for the page, not one a row: it reads the relations when it opens,
         which is the same dialog the person's own page offers. -->
    <AdminPublishNodeDialog
      v-if="publishing"
      v-model="publishOpen"
      :node-id="publishing.personId"
      :node-name="publishing.name"
      @published="onPublished"
      @failed="onPublishFailed"
    />

    <v-snackbar
      v-model="snackbar"
      :timeout="4000"
      :color="snackbarError ? 'error' : undefined"
    >
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { mdiRefresh } from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { polishCounting, polishCountingGenitive } from "~/composables/polish";
import { formatCount } from "~/utils/chartTheme";
import {
  declarationDateText,
  declarationDrainText,
  declarationHoldLabel,
  declarationRecheckText,
  groupDeclarationRuns,
} from "~/utils/declarationsAdmin";
import {
  DISPUTED_AFTER,
  PEOPLE_IMPORT_WINDOW,
  PRESS_BATCH,
  READERS_TO_AGREE,
  type DeclarationOverview,
  type DeclarationPeople,
  type DeclarationPublicationRow,
  type DeclarationReviewRow,
  type DrainResult,
  type PublicationHoldReason,
  type RecheckResult,
} from "~~/shared/declarations";
import { shortWarsawTime } from "~~/shared/jobs";

/** /admin/oswiadczenia: how far the reading of BIP declarations has got, and
 * what in it needs an admin.
 *
 * The job finds a councillor's declaration, readers type the birth date off
 * the crop without seeing the page's, and an agreed date that matches the
 * page publishes the page, a few a day. This page follows that chain: the
 * head says how far each stage got and what today's publications are against
 * the limit; under it come the crops readers could not agree on, the
 * readings the page contradicts and the publications held back - each opens
 * to the crop, the readings and the pages, with the decision at its foot.
 *
 * Everything is read in the browser, with the admin's token: the crops are
 * handwriting of named people, and the page dates are the one thing a reader
 * must never see beside them. */
definePageMeta({
  middleware: "admin",
  // One column of rows, like the other admin lists.
  maxWidth: 1100,
});

useHead({ title: "Oświadczenia majątkowe (Admin)" });

const overview = ref<DeclarationOverview | null>(null);

// The night's people count: public, cached, and nothing on this page waits
// for it.
const { data: peopleData } = useFetch<{ people: DeclarationPeople | null }>(
  "/api/declarations/people",
  { key: "declarations-people", lazy: true },
);
const peopleSnapshot = computed(() => peopleData.value?.people ?? null);
const loading = ref(false);
const error = ref<string | null>(null);
/** The clock the rows' times are told against, moved on each load. */
const now = ref(new Date());

/** The method, behind the (i): who reads, what settles a reading, what
 * publishes, and what the button at the end of the chain does. Read off the
 * same numbers the server settles by. */
const headInfo = computed(() => {
  const limit = overview.value?.dailyLimit;
  const pace =
    limit === undefined
      ? "kilka osób dziennie"
      : limit > 0
        ? `najwyżej ${polishCounting(limit, "osobę", "osoby", "osób")} dziennie`
        : "ale publikowanie automatyczne jest teraz wyłączone";
  const { from, to } = PEOPLE_IMPORT_WINDOW;
  return (
    "Zadanie na predatorze szuka w BIP-ach oświadczeń majątkowych radnych, " +
    "którzy mają stronę w serwisie, wycina z nich linię z datą urodzenia i " +
    "przesyła wycinki tutaj. Datę wpisaną na komputerze zadanie ustala samo, " +
    "gdy odczyt jest pewny; z pozostałych wycinków datę przepisują " +
    "czytelnicy, nie widząc daty ze strony osoby. Odczyt czytelników jest " +
    `rozstrzygnięty przy zgodzie co najmniej ${polishCountingGenitive(READERS_TO_AGREE, "osoby", "osób")} ` +
    `i przewadze ${polishCountingGenitive(READERS_TO_AGREE, "głosu", "głosów")} nad każdą inną datą, ` +
    "a wycinek, co do którego się nie zgodzą, rozstrzyga administrator. " +
    "Ustaloną datę porównuje się z datą na stronie osoby. Szkic z tą samą " +
    "datą publikuje się sam, razem z zatrudnieniami w KRS i wyborami w " +
    `regionie z oświadczenia, ${pace}. ` +
    "Przycisk „Opublikuj z kolejki” publikuje od razu do " +
    `${polishCountingGenitive(PRESS_BATCH, "czekającej osoby", "czekających osób")}, ` +
    "ponad dzienny limit, także przy wyłączonym publikowaniu automatycznym. " +
    "Każda strona przechodzi te same sprawdzenia co przy publikacji " +
    "automatycznej, więc część może zostać wstrzymana, a „Dziś” liczy tylko " +
    "publikacje automatyczne. W czasie " +
    `importu osób, w tym nocnego od ${from}:00 do ${to}:00, nie publikuje ` +
    "się nikogo, także przyciskiem. Data przyjęta przez administratora " +
    "nikogo nie publikuje: szkic z nią czeka w sekcji „Wstrzymane " +
    "publikacje” na publikację ręczną."
  );
});

const errorText = (err: unknown, fallback: string) =>
  (err as { data?: { message?: string } }).data?.message || fallback;

async function load() {
  loading.value = true;
  error.value = null;
  try {
    overview.value = await authRequest<DeclarationOverview>(
      "/api/declarations/overview",
      { method: "GET" },
    );
    now.value = new Date();
  } catch (err) {
    error.value = errorText(err, "Nie udało się wczytać przeglądu oświadczeń.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** Nothing has come from the job at all - different from a run with
 * nothing to do, whose lists still have their counts and their "nothing"
 * to show. */
const nothingYet = computed(
  () =>
    !!overview.value &&
    overview.value.candidacies.total === 0 &&
    overview.value.extracts.total === 0,
);

const runCount = computed(() =>
  overview.value ? groupDeclarationRuns(overview.value.runs).length : 0,
);

/** The recent publications start folded to a screenful: they are the record,
 * not the work. */
const RECENT_LIMIT = 10;
const showAllRecent = ref(false);
const recentShown = computed(() => {
  const recent = overview.value?.lists.recent ?? [];
  return showAllRecent.value ? recent : recent.slice(0, RECENT_LIMIT);
});

/** A hundred held rows would push everything under them off the page. */
const HELD_LIMIT = 20;
const showAllHeld = ref(false);
const pickedReason = ref<PublicationHoldReason | null>(null);
/** What the held rows are narrowed to, null for all of them. A reason whose
 * last row has just been decided is no longer among the select's items, and
 * the list goes back to everything rather than to nothing. */
const heldReason = computed({
  get: () =>
    overview.value?.publications.heldBy.some(
      ({ reason }) => reason === pickedReason.value,
    )
      ? pickedReason.value
      : null,
  set: (reason) => {
    pickedReason.value = reason;
  },
});

// TEMP(wariant): which of the two structures the round shows.
const route = useRoute();
const wariant = computed(() =>
  route.query.wariant === "b" ? ("b" as const) : ("a" as const),
);
const heldView = ref<"waiting" | "aside">("waiting");

const heldRows = computed(() => {
  const lists = overview.value?.lists;
  if (!lists) return [];
  if (heldView.value === "aside") return lists.setAside;
  const reason = heldReason.value;
  return reason ? lists.held.filter((row) => row.reason === reason) : lists.held;
});
const heldShown = computed(() =>
  showAllHeld.value ? heldRows.value : heldRows.value.slice(0, HELD_LIMIT),
);

/** Every reason something is held for now, by how many it holds. */
const reasonOptions = computed(() => {
  const publications = overview.value?.publications;
  if (!publications) return [];
  return [
    { title: `Wszystkie (${formatCount(publications.held)})`, value: null },
    ...publications.heldBy.map(({ reason, count }) => ({
      title: `${declarationHoldLabel({ status: "held", reason, pagePublic: false, paidPost: true })} (${formatCount(count)})`,
      value: reason,
    })),
  ];
});

const heldInfo =
  "Osoby z tą samą datą i z płatnym stanowiskiem na stronie, których stron nie opublikowano ani automatycznie, ani przyciskiem „Opublikuj z kolejki”, bo ktoś już o nich zdecydował albo coś budzi wątpliwość. Niebieskie to cudza decyzja, bursztynowe czekają na wyjaśnienie. W otwartym wierszu są trzy wyjścia. „Sprawdź ponownie” przepuszcza stronę przez wszystkie sprawdzenia publikacji automatycznej, gdy to, co ją wstrzymało, już zniknęło, i publikuje ją razem z powiązaniami. „Opublikuj ręcznie” pomija sprawdzenia: sam wybierasz powiązania, które wyjdą ze stroną. „Nie publikuj” przenosi osobę do sekcji „Nie do publikacji”, skąd można ją przywrócić. Strona opublikowana ręcznie znika z listy, skądkolwiek ją opublikowano.";

/** Who will not be published is the record, not the work: a few rows, the
 * newest first, so that a „Nie publikuj” shows up here to be taken back. */
const ASIDE_LIMIT = 5;
const showAllAside = ref(false);
const asideShown = computed(() => {
  const aside = overview.value?.lists.setAside ?? [];
  return showAllAside.value ? aside : aside.slice(0, ASIDE_LIMIT);
});

/** Open rows, kept here so a reload after a decision keeps the others open.
 * Keyed by list too: a person can be in two of them. */
const openRows = reactive(new Set<string>());
const setOpen = (key: string, open: boolean) =>
  open ? openRows.add(key) : openRows.delete(key);

// ---- decisions ----

const snackbar = ref(false);
const snackbarText = ref("");
const snackbarError = ref(false);

function notify(text: string, isError = false) {
  snackbarText.value = text;
  snackbarError.value = isError;
  snackbar.value = true;
}

type Decision = "settle" | "unreadable" | "withdraw";

/** The decision on each crop being sent, by id. */
const busy = reactive(new Map<string, Decision>());

async function decide(
  row: DeclarationReviewRow,
  decision: Decision,
  value?: string,
) {
  if (busy.has(row.id)) return;
  busy.set(row.id, decision);
  const base = `/api/declarations/${encodeURIComponent(row.id)}`;
  try {
    if (decision === "withdraw") {
      await authRequest(`${base}/withdraw`, { method: "POST" });
      notify("Wycinek wycofany.");
    } else if (decision === "unreadable") {
      await authRequest(`${base}/settle`, {
        method: "POST",
        body: { verdict: "unreadable" },
      });
      notify("Wycinek uznany za nieczytelny.");
    } else {
      await authRequest(`${base}/settle`, {
        method: "POST",
        body: { verdict: "date", value },
      });
      notify(`Przyjęto ${declarationDateText(value)}.`);
    }
    // The row leaves its list with the decision; the next one is where the
    // eye already is.
    openRows.delete(`disputed:${row.id}`);
    openRows.delete(`different:${row.id}`);
    await load();
  } catch (err) {
    notify(errorText(err, "Nie udało się zapisać decyzji."), true);
  } finally {
    busy.delete(row.id);
  }
}

type HoldDecision = "recheck" | "decline" | "restore";

/** The decision on each held page being sent, by person. */
const holdBusy = reactive(new Map<string, HoldDecision>());

const holdDone: Record<Exclude<HoldDecision, "recheck">, string> = {
  decline: "Przeniesiono do sekcji „Nie do publikacji”.",
  restore: "Przywrócono do wstrzymanych.",
};

async function decideHold(
  row: DeclarationPublicationRow,
  decision: HoldDecision,
) {
  if (holdBusy.has(row.personId)) return;
  holdBusy.set(row.personId, decision);
  const url = `/api/declarations/publications/${encodeURIComponent(row.personId)}/${decision}`;
  try {
    const result = await authRequest<RecheckResult>(url, { method: "POST" });
    notify(
      decision === "recheck" ? declarationRecheckText(result) : holdDone[decision],
    );
    // The row leaves its list with most of these; if it stays, it is the
    // admin's to read what changed.
    if (decision !== "recheck" || result.outcome !== "held") {
      openRows.delete(`held:${row.personId}`);
      openRows.delete(`aside:${row.personId}`);
    }
    await load();
  } catch (err) {
    notify(errorText(err, "Nie udało się zapisać decyzji."), true);
  } finally {
    holdBusy.delete(row.personId);
  }
}

/** The held page „Opublikuj ręcznie” was pressed on. */
const publishing = ref<DeclarationPublicationRow | null>(null);
const publishOpen = ref(false);

/** The dialog reads what it shows when it opens, so it has to be up with this
 * person's id before it is told to. */
async function openPublish(row: DeclarationPublicationRow) {
  publishing.value = row;
  await nextTick();
  publishOpen.value = true;
}

/** The server closes the hold with the publication, wherever it is pressed. */
async function onPublished({ relations }: { relations: number }) {
  const row = publishing.value;
  if (row) {
    openRows.delete(`held:${row.personId}`);
    openRows.delete(`aside:${row.personId}`);
  }
  notify(
    relations > 0
      ? `Opublikowano stronę z ${polishCountingGenitive(relations, "powiązaniem", "powiązaniami")}.`
      : "Opublikowano stronę.",
  );
  await load();
}

/** The page half and the relations half are two calls: with the page up, the
 * dialog stays open to say so, and the list has to catch up behind it. */
async function onPublishFailed({
  error: err,
  nodePublished,
}: {
  error: unknown;
  nodePublished: boolean;
}) {
  notify(
    nodePublished
      ? "Strona wyszła, ale jej powiązania nie."
      : errorText(err, "Nie udało się opublikować strony."),
    true,
  );
  if (nodePublished) await load();
}

/** The cap's button: an admin's press, past the daily limit. What the
 * snackbar says is what the pass reports - who went up, who was held, and how
 * many still wait - since the night window or a running import may let it
 * publish nobody, and a check may hold a page. True once the pass has
 * answered, so the cap closes its question; false on a failure, which leaves
 * it up for another try. */
async function publishQueued(): Promise<boolean> {
  try {
    const result = await authRequest<DrainResult>(
      "/api/declarations/publish-queued",
      { method: "POST" },
    );
    notify(declarationDrainText(result));
    await load();
    return true;
  } catch (err) {
    notify(errorText(err, "Nie udało się opublikować kolejki."), true);
    return false;
  }
}
</script>

<style scoped>
/* The bar and the chain under it are one block: the whole of the run by
 * state, then the stages. */
.dprogress {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ---- head: the admin pages' approved frame, 40/700 and 28 on a phone ---- */

.dhead {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px 24px;
  margin-bottom: 32px;
}

.dhead__text {
  flex: 1 1 320px;
  min-width: 0;
}

/* The bubble follows the title's last word wherever a long title wraps. */
.dhead__title {
  line-height: 1.1;
  text-wrap: balance;
}

.dhead__title h1 {
  display: inline;
  margin: 0;
  font-size: 2.5rem;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.025em;
  overflow-wrap: break-word;
}

.dhead__title :deep(.sec-head__info) {
  margin-inline-start: 8px;
  vertical-align: baseline;
}

.dhead__lead {
  margin: 8px 0 0;
  max-width: 62ch;
  font-size: 1.25rem;
  line-height: 1.45;
  letter-spacing: -0.01em;
  color: rgba(var(--v-theme-on-surface), 0.6);
  text-wrap: pretty;
}

/* The button centres on the title's first line, 44px at 40/1.1. */
.dhead__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  min-height: 44px;
}

/* ---- sections: one 40px step apart, as on the other admin pages ---- */

.dsection {
  margin-top: 40px;
  /* Clears the sticky toolbar when the chain's links scroll here. */
  scroll-margin-top: 96px;
}

.dsection__empty {
  margin: 0;
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

/* Wide enough for the longest reason, which is a whole sentence's worth. */
.dheld__reason {
  width: 300px;
  max-width: 100%;
  flex: 0 1 300px;
}

@media (max-width: 599.98px) {
  .dhead {
    margin-bottom: 24px;
  }

  .dhead__title h1 {
    font-size: 1.75rem;
  }

  .dhead__lead {
    font-size: 1rem;
    line-height: 1.55;
    letter-spacing: normal;
  }

  .dhead__actions {
    min-height: 0;
  }

  .dsection {
    margin-top: 32px;
  }
}
</style>
