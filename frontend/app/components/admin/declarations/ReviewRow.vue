<template>
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="`oswiadczenie-${row.id}`"
    class="drev"
    :tone="tone"
    :label="toggleLabel"
    :data-declaration-id="row.id"
    data-declaration-row
  >
    <template #summary>
      <!-- Disputed: what the readers typed, since that is the dispute.
           Different: the agreed reading against the page's date, the digits
           that differ marked - which is the decision. -->
      <template v-if="kind === 'different' && row.agreed">
        <AdminDeclarationsDateCompare
          class="arow-fixed"
          :reading="row.agreed"
          :stored="firstPerson?.birthDate ?? null"
        />
        <span class="arow-grow drev__who">
          {{ firstPerson?.name ?? row.unit }}
          <span v-if="row.people.length > 1" class="text-medium-emphasis">
            i {{ row.people.length - 1 }}
          </span>
        </span>
        <span
          v-if="difference"
          class="arow-tag drev__difference"
          :class="toneClasses(declarationDifferenceTone(difference))"
        >
          {{ declarationDifferenceLabels[difference] }}
        </span>
      </template>
      <template v-else>
        <span class="arow-fixed drev__readings">{{ readingsLine }}</span>
        <span class="arow-grow drev__where">{{ where }}</span>
        <span class="arow-fixed text-medium-emphasis drev__answers">
          {{ answersText }}
        </span>
      </template>
    </template>

    <template #meta>
      <AdminRowFact label="Jednostka">{{ row.unit }}</AdminRowFact>
      <AdminRowFact label="Urząd">{{
        row.office ?? "nie podano"
      }}</AdminRowFact>
      <AdminRowFact label="Oświadczenie za rok">
        {{ row.declarationYear ?? "nie podano" }}
      </AdminRowFact>
      <AdminRowFact label="Odczyt maszyny">{{ machineText }}</AdminRowFact>
      <AdminRowFact label="Ostatnia zmiana">
        {{ shortWarsawTime(row.updatedAt, now) }}
      </AdminRowFact>
    </template>

    <div class="drev__grid">
      <!-- The crop comes first: everything below is checked against it. -->
      <section class="drev__crop" aria-label="Wycinek">
        <h3 class="drev__subhead">Wycinek</h3>
        <v-skeleton-loader
          v-if="imagesLoading"
          type="image"
          height="64"
          class="drev__crop-loading"
        />
        <p v-else-if="imagesError" class="drev__note" data-crop-error>
          {{ imagesError }}
          <v-btn size="small" variant="text" @click="loadImages">
            Spróbuj ponownie
          </v-btn>
        </p>
        <template v-else-if="images">
          <!-- At its own size and scrolled sideways on a phone: scaled to a
               375px screen a crop is about 40px tall, which is too small to
               read the digits that are the whole point of it. -->
          <div class="drev__image" data-crop="date">
            <img
              :src="images.date"
              alt="Wycinek z oświadczenia: linia z datą urodzenia"
            />
          </div>
          <div v-if="images.name" class="drev__image" data-crop="name">
            <img
              :src="images.name"
              alt="Wycinek z oświadczenia: imię i nazwisko"
            />
          </div>
        </template>
        <a
          class="drev__document"
          :href="row.documentUrl"
          target="_blank"
          rel="noopener"
          data-document-link
        >
          <v-icon :icon="mdiOpenInNew" size="14" />
          Całe oświadczenie w BIP<span v-if="host" class="text-medium-emphasis">
            ({{ host }})</span
          >
        </a>
      </section>

      <section class="drev__readings-list" aria-label="Odczyty">
        <h3 class="drev__subhead">Odczyty czytelników</h3>
        <ul class="drev__list">
          <li
            v-for="reading in row.readings"
            :key="reading.value"
            class="drev__reading"
            :data-reading="reading.value"
          >
            <span class="drev__reading-value">
              {{ declarationDateText(reading.value) }}
            </span>
            <span class="drev__reading-bar" aria-hidden="true">
              <span
                class="drev__reading-fill"
                :class="
                  reading.value === row.agreed
                    ? 'bg-ink-sage'
                    : 'bg-ink-neutral'
                "
                :style="{ width: `${(reading.readers / maxReaders) * 100}%` }"
              />
            </span>
            <span class="drev__reading-count">
              {{ polishCounting(reading.readers, "osoba", "osoby", "osób") }}
            </span>
            <span
              v-if="reading.value === row.agreed"
              class="arow-tag bg-surface-sage text-ink-sage"
            >
              uzgodniony
            </span>
            <v-btn
              v-else-if="kind === 'disputed'"
              size="small"
              variant="text"
              color="ink-success"
              :loading="busy === 'settle' && settling === reading.value"
              :disabled="!!busy"
              data-settle-reading
              @click="settle(reading.value)"
            >
              Przyjmij
            </v-btn>
          </li>
          <li v-if="row.unreadable > 0" class="drev__reading">
            <span class="drev__reading-value text-medium-emphasis">
              nieczytelne
            </span>
            <span class="drev__reading-bar" aria-hidden="true">
              <span
                class="drev__reading-fill bg-ink-neutral"
                :style="{ width: `${(row.unreadable / maxReaders) * 100}%` }"
              />
            </span>
            <span class="drev__reading-count">
              {{ polishCounting(row.unreadable, "osoba", "osoby", "osób") }}
            </span>
          </li>
          <li v-if="!row.readings.length && !row.unreadable" class="drev__note">
            Nikt jeszcze nie odpowiedział.
          </li>
        </ul>

        <h3 class="drev__subhead mt-4">
          {{ row.people.length === 1 ? "Strona" : "Strony" }}
        </h3>
        <ul class="drev__list">
          <li
            v-for="person in row.people"
            :key="person.id"
            class="drev__person"
            :data-person="person.id"
          >
            <NuxtLink :to="`/entity/person/${person.id}`" class="drev__name">
              {{ person.name }}
            </NuxtLink>
            <span
              class="arow-tag"
              :class="
                person.published
                  ? 'bg-surface-success text-ink-success'
                  : 'bg-surface-muted text-ink-neutral'
              "
            >
              {{ person.published ? "publiczna" : "szkic" }}
            </span>
            <!-- A dispute is read blind here too: the page's date beside
                 the crop is the one answer that must not be copied, since a
                 reading that matches it publishes. It is a click away for
                 when the crop has been decided. -->
            <template v-if="kind === 'different' && row.agreed">
              <AdminDeclarationsDateCompare
                :reading="row.agreed"
                :stored="person.birthDate"
              />
            </template>
            <span v-else-if="datesShown" class="drev__page-date" data-page-date>
              na stronie: {{ declarationDateText(person.birthDate) }}
            </span>
          </li>
        </ul>
        <v-btn
          v-if="kind === 'disputed' && !datesShown"
          size="small"
          variant="text"
          class="drev__reveal"
          :prepend-icon="mdiEyeOutline"
          data-reveal-dates
          @click="datesShown = true"
        >
          Pokaż daty ze stron
        </v-btn>
      </section>
    </div>

    <template #footer>
      <form class="drev__settle" @submit.prevent="settleTyped">
        <v-text-field
          v-model="typed"
          class="drev__field"
          label="Data z wycinka"
          placeholder="np. 15.07.1979"
          density="compact"
          variant="outlined"
          hide-details="auto"
          :hint="typedHint"
          persistent-hint
          :error-messages="typedError"
          autocomplete="off"
          data-settle-field
        />
        <v-btn
          type="submit"
          variant="tonal"
          color="ink-success"
          :prepend-icon="mdiCheck"
          :disabled="!parsedValue || !!busy"
          :loading="busy === 'settle' && settling === parsedValue"
          data-settle
        >
          Przyjmij datę
        </v-btn>
      </form>
      <v-btn
        class="drev__decision"
        variant="outlined"
        :prepend-icon="mdiEyeOffOutline"
        :disabled="!!busy"
        :loading="busy === 'unreadable'"
        data-unreadable
        @click="emit('unreadable')"
      >
        Nieczytelne
      </v-btn>
      <span class="drev__withdraw">
        <template v-if="confirmWithdraw">
          <span class="drev__confirm">{{ withdrawQuestion }}</span>
          <v-btn
            class="drev__decision"
            variant="flat"
            color="ink-danger"
            :loading="busy === 'withdraw'"
            data-withdraw-confirm
            @click="emit('withdraw')"
          >
            Wycofaj
          </v-btn>
          <v-btn
            class="drev__decision"
            variant="text"
            :disabled="busy === 'withdraw'"
            @click="confirmWithdraw = false"
          >
            Anuluj
          </v-btn>
        </template>
        <v-btn
          v-else
          class="drev__decision"
          variant="text"
          color="ink-danger"
          :prepend-icon="mdiUndoVariant"
          :disabled="!!busy"
          data-withdraw
          @click="confirmWithdraw = true"
        >
          Wycofaj wycinek
        </v-btn>
      </span>
    </template>
  </AdminExpandRow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  mdiCheck,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiOpenInNew,
  mdiUndoVariant,
} from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { polishCounting } from "~/composables/polish";
import type { RowTone } from "~/composables/rowTone";
import { toneClasses } from "~/utils/jobStyle";
import {
  compareDeclarationDates,
  declarationConfidenceLabel,
  declarationDateText,
  declarationDifferenceLabels,
  declarationDifferenceTone,
} from "~/utils/declarationsAdmin";
import { longDate } from "~~/shared/dates";
import { parseTypedDate } from "~~/shared/declarations";
import type { DeclarationReviewRow } from "~~/shared/declarations";
import { shortWarsawTime } from "~~/shared/jobs";

/** One crop an admin has to decide on: readers who could not agree on it
 * (`disputed`), or a date they agreed on that the page contradicts
 * (`different`).
 *
 * Open, it shows the crop itself - fetched when the row opens, since a list of
 * crops is a list of handwriting nobody asked to see yet - with what readers
 * typed, the pages it is for and the whole form on BIP. The decisions are
 * the reader's three, made final: a date, "unreadable", or taking the crop
 * back when it is not this person's. The row only asks for them; the page
 * sends them and reloads, as `FeedbackReportRow` leaves its writes to
 * /admin/opinie. */
const props = defineProps<{
  row: DeclarationReviewRow;
  kind: "disputed" | "different";
  /** The decision on this row being sent, if one is. */
  busy?: "settle" | "unreadable" | "withdraw" | null;
  now: Date;
}>();

const emit = defineEmits<{
  settle: [value: string];
  unreadable: [];
  withdraw: [];
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

const firstPerson = computed(() => props.row.people[0] ?? null);

const difference = computed(() =>
  props.row.agreed
    ? (compareDeclarationDates(
        props.row.agreed,
        firstPerson.value?.birthDate ?? null,
      )?.kind ?? null)
    : null,
);

/** A dispute is somebody's to settle, so it is red like the conflict counts
 * elsewhere; a contradiction takes the colour of how far apart the dates are:
 * a year apart is likely another person, a digit a misreading. */
const tone = computed<RowTone>(() =>
  props.kind === "disputed"
    ? "danger"
    : difference.value
      ? declarationDifferenceTone(difference.value)
      : "warning",
);

const where = computed(() =>
  [props.row.unit, props.row.office].filter(Boolean).join(" · "),
);

/** The two leading readings, the way the open row lists them all. */
const readingsLine = computed(() => {
  const top = props.row.readings
    .slice(0, 2)
    .map((r) => `${declarationDateText(r.value)} ×${r.readers}`);
  if (props.row.unreadable) top.push(`nieczytelne ×${props.row.unreadable}`);
  return top.join(" · ") || "bez odczytów";
});

const answers = computed(
  () =>
    props.row.readings.reduce((sum, r) => sum + r.readers, 0) +
    props.row.unreadable,
);

const answersText = computed(() =>
  polishCounting(answers.value, "odpowiedź", "odpowiedzi", "odpowiedzi"),
);

/** The line as a sentence, for the toggle's accessible name: the summary
 * alone is figures and "×3", which a screen reader says as "razy trzy". */
const toggleLabel = computed(() => {
  const row = props.row;
  if (props.kind === "different" && row.agreed) {
    const who = firstPerson.value?.name ?? row.unit;
    const others =
      row.people.length > 1
        ? ` i ${polishCounting(row.people.length - 1, "inna strona", "inne strony", "innych stron")}`
        : "";
    const stored = firstPerson.value?.birthDate;
    const kind = difference.value
      ? `, ${declarationDifferenceLabels[difference.value]}`
      : "";
    return `${who}${others}: odczyt z wycinka ${declarationDateText(row.agreed)}, na stronie ${stored ? declarationDateText(stored) : "brak daty"}${kind}`;
  }
  const readings = row.readings.map(
    (r) =>
      `${declarationDateText(r.value)}: ${polishCounting(r.readers, "osoba", "osoby", "osób")}`,
  );
  if (row.unreadable) {
    readings.push(
      `nieczytelne: ${polishCounting(row.unreadable, "osoba", "osoby", "osób")}`,
    );
  }
  const place = [row.unit, row.office].filter(Boolean).join(", ");
  return `Sporny wycinek, ${place}. Odczyty: ${readings.join("; ") || "brak"}. ${answersText.value}`;
});

const maxReaders = computed(() =>
  Math.max(
    1,
    props.row.unreadable,
    ...props.row.readings.map((r) => r.readers),
  ),
);

const machineText = computed(() => {
  const machine = props.row.machine;
  if (!machine?.birthDate) return "brak";
  const confidence = declarationConfidenceLabel(machine.confidence);
  const date = declarationDateText(machine.birthDate);
  return confidence ? `${date}, ${confidence}` : date;
});

const host = computed(() => {
  try {
    return new URL(props.row.documentUrl).host;
  } catch {
    return null;
  }
});

// ---- the crop ----

const images = ref<{ date: string; name: string | null } | null>(null);
const imagesLoading = ref(false);
const imagesError = ref<string | null>(null);

async function loadImages() {
  imagesLoading.value = true;
  imagesError.value = null;
  try {
    images.value = await authRequest<{ date: string; name: string | null }>(
      `/api/declarations/${encodeURIComponent(props.row.id)}/images`,
      { method: "GET" },
    );
  } catch {
    imagesError.value = "Nie udało się wczytać wycinka.";
  } finally {
    imagesLoading.value = false;
  }
}

watch(
  expanded,
  (open) => {
    if (open && !images.value && !imagesLoading.value) void loadImages();
  },
  { immediate: true },
);

// ---- the decisions ----

const datesShown = ref(false);
const confirmWithdraw = ref(false);
const typed = ref("");
/** The value a settle was sent with, so only its button spins. */
const settling = ref<string | null>(null);

const parsed = computed(() => parseTypedDate(typed.value));
const parsedValue = computed(() =>
  parsed.value.kind === "date" || parsed.value.kind === "year"
    ? parsed.value.value
    : null,
);

const typedHint = computed(() => {
  const value = parsedValue.value;
  if (!value) return "Można wpisać sam rok";
  return parsed.value.kind === "year" ? `rok ${value}` : longDate(value);
});

const typedError = computed(() => {
  const result = parsed.value;
  if (result.kind !== "invalid" || result.reason === "empty") return [];
  return result.reason === "range"
    ? ["Tej daty nie ma w zakresie lat urodzenia"]
    : ["Nie rozumiem tej daty - wpisz np. 15.07.1979"];
});

function settle(value: string) {
  settling.value = value;
  emit("settle", value);
}

function settleTyped() {
  if (parsedValue.value) settle(parsedValue.value);
}

const withdrawQuestion = computed(() =>
  props.kind === "different"
    ? "Wycofać wycinek? Odczyt przestanie się liczyć dla tej strony."
    : "Wycofać wycinek? Zniknie z odczytów i z tej listy.",
);
</script>

<style scoped>
.drev__who,
.drev__where {
  font-size: 0.875rem;
}

.drev__readings {
  font-size: 0.875rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.drev__answers {
  font-size: 0.75rem;
}

.drev__grid {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 16px 32px;
}

.drev__subhead {
  margin: 0 0 8px;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

/* The crop on a white card inside a hairline, so a scan's own white edge
 * does not run into the row. */
.drev__image {
  margin-bottom: 8px;
  padding: 4px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 6px;
  background: rgb(var(--v-theme-surface));
}

.drev__image img {
  display: block;
  max-width: 100%;
  height: auto;
}

.drev__crop-loading {
  margin-bottom: 8px;
}

.drev__document {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8125rem;
}

.drev__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.drev__reading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  font-size: 0.875rem;
}

.drev__reading-value {
  flex: none;
  min-width: 6.5em;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.drev__reading-bar {
  flex: 0 1 96px;
  height: 4px;
  border-radius: 2px;
  background: rgb(var(--v-theme-surface-muted));
  overflow: hidden;
}

.drev__reading-fill {
  display: block;
  height: 100%;
}

.drev__reading-count {
  flex: none;
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-variant-numeric: tabular-nums;
}

.drev__person {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: 0.875rem;
}

.drev__name {
  font-weight: 500;
}

.drev__page-date {
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.drev__reveal {
  margin-top: 4px;
  margin-inline-start: -8px;
}

.drev__note {
  margin: 0;
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

/* The decisions line up on the date field's top edge, at its height: the
 * field's hint hangs under it and would otherwise pull the buttons beside it
 * down to its middle. */
.drev :deep(.arow__footer) {
  align-items: flex-start;
}

/* One line, the field giving way down to its minimum: a wrapping form sized
 * by its content broke the button under the field on a desktop. */
.drev__settle {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.drev__settle :deep(.v-btn),
.drev__decision {
  height: 40px;
}

.drev__field {
  flex: 0 1 220px;
  min-width: 180px;
}

.drev__withdraw {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-inline-start: auto;
}

.drev__confirm {
  font-size: 0.8125rem;
  font-weight: 500;
}

@media (max-width: 959.98px) {
  .drev__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* On a phone the line breaks in two - the dates first, who or where under
 * them - and the crop keeps its own size and scrolls sideways rather than
 * shrinking past reading. The empty item ordered between the halves forces
 * the break. */
@media (max-width: 599.98px) {
  /* A flex item keeps its content's width unless told otherwise, and the
   * dates, the tag and a long name would push the page sideways. */
  .drev :deep(.arow__toggle) {
    flex-wrap: wrap;
    row-gap: 2px;
    min-width: 0;
  }

  .drev :deep(.arow__toggle)::after {
    content: "";
    order: 1;
    flex-basis: 100%;
  }

  .drev__where,
  .drev__who,
  .drev__difference {
    order: 2;
  }

  .drev__where,
  .drev__who {
    flex: 1 1 0;
    padding-inline-start: 28px;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  /* Three readings do not fit a phone's line; the open row lists them all.
   * A zero basis, so they take what the count leaves of the first line
   * rather than a line of their own with the count wrapped under them. */
  .drev__readings {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .drev__image {
    overflow-x: auto;
  }

  .drev__image img {
    max-width: none;
  }

  .drev__withdraw {
    margin-inline-start: 0;
  }

  .drev__settle {
    flex-wrap: wrap;
  }
}
</style>
