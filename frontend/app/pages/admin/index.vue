<template>
  <div class="w-100">
    <AdminPageHead
      title="Panel administracyjny"
      lead="Przegląd podstron administracyjnych i zadań wymagających uwagi."
    />

    <!-- The work queues first: they are what the panel is opened for, most
         often on a phone. Under seven tiles they started about 1240px down.
         Most subpages are in the strip's menus as well, but „Powiązania” and
         „Ekstrakcje” are in none, so the list at the bottom is the way in to
         them (a menu entry for each is the layout's to add). -->
    <div class="k-sections">
      <!-- Action items -->
      <section>
        <AdminSectionHead title="Wymagające działania">
          <v-btn
            :icon="mdiRefresh"
            variant="text"
            size="small"
            aria-label="Odśwież"
            :loading="pending"
            @click="loadSummary"
          />
        </AdminSectionHead>

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          class="mb-4"
          :text="error"
        />

        <!-- Three to a row from lg: at two, the third card stood alone beside
             half a row of nothing. -->
        <v-row>
          <!-- Untriaged feedback -->
          <v-col cols="12" md="6" lg="4">
            <v-card
              height="100%"
              variant="outlined"
              class="apanel d-flex flex-column"
            >
              <v-card-item>
                <template #prepend>
                  <v-icon :icon="mdiMessageAlertOutline" color="primary" />
                </template>
                <v-card-title class="apanel__title">
                  Nowe zgłoszenia
                  <InfoBubble label="Nowe zgłoszenia">
                    Wysłane przyciskiem „Zgłoś” albo z listy QA, jeszcze
                    nietknięte i poza kolejką.
                  </InfoBubble>
                </v-card-title>
                <!-- Only once there is a figure to show: a failed load used to
                     read as a green „0”, nothing to do, under the alert
                     saying it could not be read. -->
                <template #append>
                  <v-progress-circular v-if="pending" indeterminate size="20" />
                  <v-chip
                    v-else-if="summary"
                    :color="
                      summary.feedback.needsAction > 0 ? 'warning' : 'success'
                    "
                    variant="flat"
                  >
                    {{ polishNumber(summary.feedback.needsAction) }}
                  </v-chip>
                </template>
              </v-card-item>

              <!-- The list straight in the card rather than in its text, so
                   its rows start on the card's one 16px edge with the
                   lines and buttons around them, not 16px further in. -->
              <v-skeleton-loader v-if="pending" type="list-item-two-line@3" />
              <v-card-text
                v-else-if="summary && summary.feedback.needsAction === 0"
              >
                <v-alert
                  type="success"
                  variant="tonal"
                  density="compact"
                  :icon="mdiCheckCircleOutline"
                  text="Brak nowych zgłoszeń."
                />
              </v-card-text>
              <template v-else-if="summary">
                <!-- Each row opens its own report: /admin/opinie unfolds and
                     marks the one a #fb-<id> names. -->
                <v-list density="compact" class="apanel__list py-0">
                  <v-list-item
                    v-for="item in summary.feedback.sample"
                    :key="item.id"
                    :to="{ path: '/admin/opinie', hash: `#fb-${item.id}` }"
                    :title="feedbackPlace(item)"
                    :subtitle="item.message"
                    lines="two"
                  />
                </v-list>
                <div
                  v-if="
                    summary.feedback.needsAction >
                    summary.feedback.sample.length
                  "
                  class="text-caption text-medium-emphasis px-4 pt-1"
                >
                  …i
                  {{
                    polishNumber(
                      summary.feedback.needsAction -
                        summary.feedback.sample.length,
                    )
                  }}
                  więcej.
                </div>
              </template>

              <v-card-actions class="mt-auto">
                <v-btn
                  variant="text"
                  color="primary"
                  to="/admin/opinie"
                  :append-icon="mdiChevronRight"
                >
                  Przejdź do zgłoszeń
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>

          <!-- Notes needing action -->
          <v-col cols="12" md="6" lg="4">
            <v-card
              height="100%"
              variant="outlined"
              class="apanel d-flex flex-column"
            >
              <v-card-item>
                <template #prepend>
                  <v-icon :icon="mdiNoteEditOutline" color="primary" />
                </template>
                <v-card-title class="apanel__title">
                  Notatki wymagające działania
                  <InfoBubble label="Notatki wymagające działania">
                    Zgłoszone poprawki i braki oraz wpisy oznaczone jako
                    „Nierozwiązane”.
                  </InfoBubble>
                </v-card-title>
                <template #append>
                  <v-progress-circular v-if="pending" indeterminate size="20" />
                  <v-chip
                    v-else-if="summary"
                    :color="
                      summary.notes.needsAction > 0 ? 'warning' : 'success'
                    "
                    variant="flat"
                  >
                    {{ polishNumber(summary.notes.needsAction) }}
                  </v-chip>
                </template>
              </v-card-item>

              <v-skeleton-loader v-if="pending" type="list-item-two-line@3" />
              <v-card-text
                v-else-if="summary && summary.notes.needsAction === 0"
              >
                <v-alert
                  type="success"
                  variant="tonal"
                  density="compact"
                  :icon="mdiCheckCircleOutline"
                  text="Żadna notatka nie czeka na decyzję."
                />
              </v-card-text>
              <template v-else-if="summary">
                <v-list density="compact" class="apanel__list py-0">
                  <v-list-item
                    v-for="(item, i) in summary.notes.sample"
                    :key="`${item.noteId}-${i}`"
                    :title="item.name ?? item.nodeId"
                    :subtitle="item.note"
                    lines="two"
                  >
                    <template #append>
                      <!-- An untriaged correction has no type yet, and it is
                           what it is on the list for, so its kind stands in. -->
                      <v-chip v-if="item.adminType" size="x-small" label>
                        {{ noteAdminTypeLabel(item.adminType) }}
                      </v-chip>
                      <v-chip
                        v-else
                        size="x-small"
                        label
                        :color="noteKindConfig[item.kind].color"
                      >
                        {{ noteKindConfig[item.kind].title }}
                      </v-chip>
                    </template>
                  </v-list-item>
                </v-list>
                <div
                  v-if="summary.notes.needsAction > summary.notes.sample.length"
                  class="text-caption text-medium-emphasis px-4 pt-1"
                >
                  …i
                  {{
                    polishNumber(
                      summary.notes.needsAction - summary.notes.sample.length,
                    )
                  }}
                  więcej.
                </div>
              </template>

              <!-- Wraps: on a phone the two buttons are wider than the card,
                   and the second one used to be cut off at „Kategoryzuj (9”. -->
              <v-card-actions class="mt-auto flex-wrap">
                <!-- Filtered to the same set the number above counts, so the
                     page it opens is the list it promised. -->
                <v-btn
                  variant="text"
                  color="primary"
                  :to="{
                    path: '/admin/notatki',
                    query: { status: 'needs_action' },
                  }"
                  :append-icon="mdiChevronRight"
                >
                  Przejdź do notatek
                </v-btn>
                <v-spacer />
                <!-- The queue reads on a phone, which is where this dashboard
                     is most often opened, so it is one tap from here. -->
                <v-btn
                  variant="text"
                  color="primary"
                  to="/admin/notatki/kategoryzacja"
                  :prepend-icon="mdiGestureTapButton"
                >
                  {{ categoriseLabel }}
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>

          <!-- Unapproved manual revisions -->
          <v-col cols="12" md="6" lg="4">
            <v-card
              height="100%"
              variant="outlined"
              class="apanel d-flex flex-column"
            >
              <v-card-item>
                <template #prepend>
                  <v-icon :icon="mdiHistory" color="primary" />
                </template>
                <v-card-title class="apanel__title">
                  Niezaakceptowane rewizje
                  <InfoBubble label="Niezaakceptowane rewizje">
                    Ręczne (nieautomatyczne) rewizje stron i powiązań oczekujące
                    na akceptację.
                  </InfoBubble>
                </v-card-title>
                <template #append>
                  <v-progress-circular v-if="pending" indeterminate size="20" />
                  <v-chip
                    v-else-if="summary"
                    :color="
                      summary.revisions.unapprovedManual > 0
                        ? 'warning'
                        : 'success'
                    "
                    variant="flat"
                  >
                    {{ polishNumber(summary.revisions.unapprovedManual)
                    }}{{ summary.revisions.truncated ? "+" : "" }}
                  </v-chip>
                </template>
              </v-card-item>

              <v-skeleton-loader v-if="pending" type="list-item@3" />
              <v-card-text
                v-else-if="summary && summary.revisions.unapprovedManual === 0"
              >
                <v-alert
                  type="success"
                  variant="tonal"
                  density="compact"
                  :icon="mdiCheckCircleOutline"
                  text="Brak ręcznych rewizji do akceptacji."
                />
              </v-card-text>
              <v-list
                v-else-if="summary"
                density="compact"
                class="apanel__list py-0"
              >
                <!-- An edge revision has no page of its own, so it opens pinned
                     in the review queue - the id is the revision's - where it
                     can be decided on, rather than in a detail view. -->
                <v-list-item
                  v-for="item in summary.revisions.sample"
                  :key="`${item.kind}-${item.id}`"
                  :to="
                    item.kind === 'edge'
                      ? `/admin/rewizje?rewizja=${encodeURIComponent(item.id)}#kolejka`
                      : `/admin/rewizje/${item.id}`
                  "
                  :title="item.name ?? item.id"
                  :subtitle="revisionTypeLabel(item)"
                  slim
                >
                  <template #prepend>
                    <v-icon
                      :icon="
                        item.kind === 'edge' ? mdiVectorPolyline : mdiHistory
                      "
                      size="small"
                      :aria-label="
                        item.kind === 'edge' ? 'Powiązanie' : 'Strona'
                      "
                    />
                  </template>
                </v-list-item>
              </v-list>
              <!-- The total is a figure, so it stays in sight; only the method
                   went behind the (i). It says what sets it apart from the
                   chip, which counts the manual ones only: bare, „28 835
                   niezaakceptowanych” under a „16+” read as two counts of one
                   thing. It sits where the sibling cards' „…i N więcej.” does,
                   not in the header, which it grew to two lines and knocked
                   the chip off the other cards' row; and right above
                   „Zmiany powiązań”, where the automatic ones are decided. -->
              <div
                v-if="!pending && summary && summary.revisions.unapproved > 0"
                class="text-caption text-medium-emphasis px-4 pt-1"
              >
                {{ polishNumber(summary.revisions.unapproved) }}
                {{
                  nominativeNoun(
                    summary.revisions.unapproved,
                    "niezaakceptowana",
                    "niezaakceptowane",
                    "niezaakceptowanych",
                  )
                }}
                łącznie z automatycznymi
              </div>

              <!-- Both into /admin/rewizje, at the section each half of the
                   count above is decided in. -->
              <v-card-actions class="mt-auto flex-wrap">
                <v-btn
                  variant="text"
                  color="primary"
                  to="/admin/rewizje#kolejka"
                  :append-icon="mdiChevronRight"
                >
                  Przejdź do kolejki
                </v-btn>
                <v-btn
                  variant="text"
                  color="primary"
                  to="/admin/rewizje#powiazania"
                  :append-icon="mdiChevronRight"
                >
                  Zmiany powiązań
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>
        </v-row>
      </section>

      <!-- Who has been working -->
      <section>
        <AdminSectionHead title="Aktywni w tym tygodniu">
          <!-- What the administrators on trial did, decision by decision. The
               table below only counts, and its links open the review queue,
               which filters on who proposed - never on who approved. -->
          <v-btn
            v-if="established"
            variant="text"
            color="primary"
            size="small"
            to="/aktywnosc?kto=nowi-admini"
            :append-icon="mdiChevronRight"
          >
            Nowi administratorzy
          </v-btn>
          <v-btn
            variant="text"
            color="primary"
            size="small"
            to="/eksploruj/statystyki"
            :append-icon="mdiChevronRight"
          >
            Pełne statystyki
          </v-btn>
        </AdminSectionHead>

        <!-- The table has an empty state of its own, „nikt nie zmieniał
             danych”, which a failed call would otherwise borrow. -->
        <v-alert
          v-if="weeklyError"
          type="error"
          variant="tonal"
          text="Nie udało się wczytać aktywności z ostatnich 7 dni."
        />
        <StatsContributorTable
          v-else
          :contributors="weekly?.contributors ?? []"
          :identified="weekly?.identified ?? false"
          :contributor-count="weekly?.contributorCount ?? 0"
          :window-days="WEEKLY_DAYS"
          :loading="pending"
        />
      </section>

      <!-- Subpages -->
      <section>
        <AdminSectionHead title="Podstrony" />
        <nav
          aria-label="Podstrony"
          class="apages k-bleed-xs"
          :style="{ '--apages-rows': subpageRows }"
        >
          <NuxtLink
            v-for="page in listedSubpages"
            :key="page.to"
            :to="page.to"
            class="apages__row"
          >
            <v-icon :icon="page.icon" color="primary" />
            <span class="apages__text">
              <span class="apages__title">{{ page.title }}</span>
              <span class="apages__desc text-medium-emphasis">
                {{ page.desc }}
              </span>
            </span>
            <v-icon :icon="mdiChevronRight" class="text-medium-emphasis" />
          </NuxtLink>
        </nav>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { computedAsync } from "@vueuse/core";
import {
  mdiGraphOutline,
  mdiHistory,
  mdiVectorPolyline,
  mdiNoteEditOutline,
  mdiTextBoxSearchOutline,
  mdiChartLine,
  mdiClipboardCheckOutline,
  mdiChevronRight,
  mdiCheckCircleOutline,
  mdiGestureTapButton,
  mdiMagnify,
  mdiRefresh,
  mdiMessageAlertOutline,
} from "@mdi/js";
import { authRequest, useAuthState } from "~/composables/auth";
import { edgeTypeLabels } from "~/composables/edges";
import { noteAdminTypeLabel, noteKindConfig } from "~/composables/notes";
import { nominativeNoun, polishNumber } from "~/composables/polish";
import type { NodeType } from "~~/shared/model";
import type { AdminSummary } from "~~/server/api/admin/summary.get";
import type { ActivityStats } from "~~/server/api/stats/activity.get";

definePageMeta({
  middleware: "admin",
});

useHead({
  title: "Panel administracyjny - koryta.pl",
});

const subpages = [
  // One entry where there were three: "Kolejka zmian", "Rewizje" and "Rewizje
  // krawędzi" are the sections of one page now.
  {
    title: "Rewizje",
    to: "/admin/rewizje",
    icon: mdiHistory,
    desc: "Propozycje czekające na decyzję, zmiany powiązań i historia każdego wpisu.",
  },
  {
    title: "Powiązania",
    to: "/admin/krawedzie",
    icon: mdiGraphOutline,
    desc: "Powiązania gotowe do publikacji - obie strony już opublikowane.",
  },
  {
    title: "Notatki",
    to: "/admin/notatki",
    icon: mdiNoteEditOutline,
    desc: "Zgłoszenia i źródła dodane przez użytkowników.",
  },
  {
    title: "Zgłoszenia",
    to: "/admin/opinie",
    icon: mdiMessageAlertOutline,
    desc: "Opinie i błędy zgłoszone przyciskiem na stronie i przy sprawdzaniu QA.",
  },
  {
    title: "QA",
    to: "/qa",
    icon: mdiClipboardCheckOutline,
    desc: "Lista zmian na stronie do sprawdzenia - otwarta dla każdego zalogowanego.",
  },
  {
    title: "Ekstrakcje",
    to: "/ekstrakcje",
    icon: mdiTextBoxSearchOutline,
    desc: "Ekstrakcje faktów ze źródeł.",
  },
  {
    title: "Statystyki",
    to: "/eksploruj/statystyki",
    icon: mdiChartLine,
    desc: "Stan bazy i kto ją ostatnio zmieniał.",
  },
  // Last, so the list reads the same for every administrator down to here.
  {
    title: "Wyszukiwania",
    to: "/admin/wyszukiwania",
    icon: mdiMagnify,
    desc: "Czego czytelnicy szukali w wyszukiwarce i czego nie znaleźli.",
    ownerOnly: true,
  },
];

const { user } = useAuthState();

/** The reader's claims, off the same token the server decides by; undefined
 * until it has been read, so nothing below flashes up for somebody it is not
 * for. */
const claims = computedAsync(
  async () => (await user.value?.getIdTokenResult())?.claims,
);

/** The entries this reader can open. The owner's own pages refuse every other
 * administrator (middleware/owner.ts), so for them a row there would only be
 * a way in to a 403; the strip's „Admin” menu hides them the same way. */
const listedSubpages = computed(() =>
  subpages.filter((page) => !page.ownerOnly || claims.value?.owner === true),
);

/** The rows of the two-column list from md, which reads down the first
 * column before the second: half the entries, rounded up. A fixed count let
 * one entry more open an implicit third column. */
const subpageRows = computed(() => Math.ceil(listedSubpages.value.length / 2));

/** The window the panel calls "this week". The stats page lets an admin widen
 * it; here it is fixed, because the question is "who is around right now". */
const WEEKLY_DAYS = 7;

/** An administrator who is not on trial - the only one /aktywnosc will show
 * who is. The page's middleware lets in anybody holding `admin`, trial
 * administrators too, and for them the "Nowi administratorzy" link led to a
 * list that quietly ignored the filter. */
const established = computed(
  () => claims.value?.admin === true && claims.value.newAdmin !== true,
);

const summary = ref<AdminSummary | null>(null);
const weekly = ref<ActivityStats | null>(null);
const pending = ref(true);
const error = ref<string | null>(null);
const weeklyError = ref(false);

/** One string, so the count keeps its space: as a `<span>` after the word it
 * was a flex item, which drops leading white space - „Kategoryzuj(937)”. */
const categoriseLabel = computed(() => {
  const count = summary.value?.notes.uncategorized;
  return count ? `Kategoryzuj (${polishNumber(count)})` : "Kategoryzuj";
});

/** Where a report was sent from, as its row names it. A page's title ends in
 * the site's name - „Mariola Duraj-Majda | Koryta.pl”, and the admin pages'
 * own „ - koryta.pl” before that - which is the half of a one-line row that
 * says nothing. Display only: the report keeps the title it was sent with.
 * The same suffix `feedbackPlace` in composables/feedbackAdmin.ts strips; that
 * one reads a whole report, which the summary's sample is not. */
const SITE_NAME_SUFFIX = /(\s*[|–—-]\s*koryta\.pl)+$/i;

function feedbackPlace(item: AdminSummary["feedback"]["sample"][number]) {
  return item.pageTitle?.replace(SITE_NAME_SUFFIX, "") || item.route;
}

/** The summary sends a revision's type as stored, which printed „person” and
 * „mentions” under Polish names. „Firma” for a place, as on /admin/rewizje,
 * where the row leads. */
const nodeTypeLabels: Record<NodeType, string> = {
  person: "Osoba",
  place: "Firma",
  article: "Artykuł",
  region: "Region",
  topic: "Temat",
};

function revisionTypeLabel(
  item: AdminSummary["revisions"]["sample"][number],
): string | undefined {
  const labels: Record<string, string> =
    item.kind === "edge" ? edgeTypeLabels : nodeTypeLabels;
  // An edge deleted since it was proposed has no type: no line rather than an
  // empty one.
  return labels[item.type] ?? (item.type || undefined);
}

const loadSummary = async () => {
  pending.value = true;
  error.value = null;
  weeklyError.value = false;
  // Independent queues; one failing should not blank the other.
  const [summaryResult, weeklyResult] = await Promise.allSettled([
    authRequest<AdminSummary>("/api/admin/summary", { method: "GET" }),
    authRequest<ActivityStats>("/api/stats/activity", {
      method: "GET",
      query: { days: WEEKLY_DAYS },
    }),
  ]);

  if (summaryResult.status === "fulfilled") {
    summary.value = summaryResult.value;
  } else {
    console.error("Failed to load admin summary", summaryResult.reason);
    error.value = "Nie udało się wczytać podsumowania.";
  }

  if (weeklyResult.status === "fulfilled") {
    weekly.value = weeklyResult.value;
  } else {
    console.error("Failed to load weekly activity", weeklyResult.reason);
    weeklyError.value = true;
  }

  pending.value = false;
};

onMounted(loadSummary);
</script>

<style scoped>
/* A card title wraps rather than ending in an ellipsis: three to a row,
   „Notatki wymagające działania” has about 240px between its icon and its
   count, and the (i) after it. Inline, so the bubble follows the last word
   instead of taking a line of its own. Vuetify's titles hyphenate, and with
   the page in Polish a browser with the dictionary would break a wrapped one
   mid-word („dzia-łania”); it wraps between words only. */
.apanel__title {
  white-space: normal;
  hyphens: manual;
}

/* A report or a note can be one bare address; it wraps into the two lines the
   row has instead of running out of the card. */
.apanel__list :deep(.v-list-item-subtitle) {
  overflow-wrap: anywhere;
}

/* Every row is its content plus Vuetify's 4px padding-block, nothing more.
   Vuetify's compact two-line minimum of 56px centred a row whose subtitle
   runs to one line, so rows stood alternately 12px and 24px apart.
   `lines="two"` stays for the subtitle's two-line clamp. */
.apanel__list :deep(.v-list-item) {
  min-height: 0;
}

/* The subpages as one ruled list, read down two columns from md: as tiles
   they ran 3 + 3 + 1, „Statystyki” alone beside two empty columns, and on a
   phone seven 130px cards took some 850px. */
.apages {
  display: grid;
  column-gap: 24px;
}

@media (min-width: 960px) {
  .apages {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-flow: column;
    grid-template-rows: repeat(var(--apages-rows), auto);
  }
}

.apages__row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 56px;
  padding: 12px 0;
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid var(--k-line);
}

.apages__row:hover,
.apages__row:focus-visible {
  background: var(--k-tonal);
}

.apages__text {
  flex: 1 1 auto;
  min-width: 0;
}

.apages__title {
  display: block;
  font-size: var(--k-body-size);
  font-weight: 600;
}

.apages__desc {
  display: block;
  font-size: var(--k-ui-size);
}

/* k-bleed-xs runs the list edge to edge on a phone, through the gutter; its
   rows keep the gutter as their inset. */
@media (max-width: 599.98px) {
  .apages__row {
    padding-inline: var(--k-gutter);
  }
}
</style>
