import {
  mdiAlertCircleOutline,
  mdiAutorenew,
  mdiCalendarAlert,
  mdiCalendarClock,
  mdiCheckCircleOutline,
  mdiCircleHalfFull,
  mdiClockAlertOutline,
  mdiClockOutline,
  mdiConsoleLine,
  mdiGestureTap,
  mdiHelpCircleOutline,
  mdiLightningBoltOutline,
  mdiMinusCircleOutline,
  mdiProgressClock,
  mdiSignalOff,
  mdiStopCircleOutline,
} from "@mdi/js";
import type { RowTone } from "~/composables/rowTone";
import { formatCount } from "~/utils/chartTheme";
import {
  isStalled,
  WARSAW,
  type JobDefinition,
  type JobHealthStatus,
  type JobKind,
  type JobProbe,
  type JobRun,
  type JobView,
  type RunProgress,
  type RunState,
  type RunTrigger,
} from "~~/shared/jobs";

/** How /admin/procesy names and draws the statuses, states and kinds of
 * `shared/jobs.ts`. The row's rail, its chip and the summary strip at the top
 * read the same table, so a job has one colour wherever it is counted. */

/** Worst first, like `JOB_HEALTH`. The four `isProblem` statuses are the only
 * red and amber ones that ask for a look; the two calmer ambers say "it
 * stopped, and that may be fine". `summary` is how the strip at the top labels
 * a count of them - a column heading, so it never has to agree with a
 * number. */
export const jobHealthConfig: Record<
  JobHealthStatus,
  { title: string; summary: string; icon: string; tone: RowTone }
> = {
  stalled: {
    title: "Bez sygnału",
    summary: "bez sygnału",
    icon: mdiSignalOff,
    tone: "danger",
  },
  failed: {
    title: "Błąd",
    summary: "z błędem",
    icon: mdiAlertCircleOutline,
    tone: "danger",
  },
  late: {
    title: "Nie wystartował",
    summary: "nie wystartowały",
    icon: mdiClockAlertOutline,
    tone: "danger",
  },
  stale: {
    title: "Nieaktualne",
    summary: "nieaktualne",
    icon: mdiCalendarAlert,
    tone: "warning",
  },
  partial: {
    title: "Niedokończony",
    summary: "niedokończone",
    icon: mdiCircleHalfFull,
    tone: "warning",
  },
  stopped: {
    title: "Zatrzymany",
    summary: "zatrzymane",
    icon: mdiStopCircleOutline,
    tone: "warning",
  },
  running: {
    title: "W toku",
    summary: "w toku",
    icon: mdiProgressClock,
    tone: "info",
  },
  ok: {
    title: "Działa",
    summary: "działa",
    icon: mdiCheckCircleOutline,
    tone: "success",
  },
  never: {
    title: "Brak raportów",
    summary: "brak raportów",
    icon: mdiMinusCircleOutline,
    tone: "neutral",
  },
  unknown: {
    title: "Nieznany",
    summary: "nieznane",
    icon: mdiHelpCircleOutline,
    tone: "neutral",
  },
};

/** One run's state, lower case: it sits mid-line in the run list. */
export const runStateConfig: Record<
  RunState,
  { title: string; icon: string; tone: RowTone }
> = {
  queued: { title: "w kolejce", icon: mdiClockOutline, tone: "neutral" },
  running: { title: "trwa", icon: mdiProgressClock, tone: "info" },
  succeeded: { title: "udany", icon: mdiCheckCircleOutline, tone: "success" },
  partial: { title: "niedokończony", icon: mdiCircleHalfFull, tone: "warning" },
  failed: { title: "błąd", icon: mdiAlertCircleOutline, tone: "danger" },
};

/** What a run that claims to be going says once it has gone quiet. A queued
 * one was never picked up, which is a different thing to be told. */
export const stalledRunConfig: Record<
  "running" | "queued",
  { title: string; icon: string; tone: RowTone }
> = {
  running: { title: "bez sygnału", icon: mdiSignalOff, tone: "danger" },
  queued: { title: "nikt nie podjął", icon: mdiSignalOff, tone: "danger" },
};

/** The run's chip: its state, unless it says it is going and has stopped
 * saying so. */
export function runChip(
  run: JobRun,
  definition: Pick<JobDefinition, "heartbeatMinutes" | "queuedMinutes">,
  now: Date,
) {
  if (
    (run.state === "running" || run.state === "queued") &&
    isStalled(run, definition, now)
  ) {
    return { ...stalledRunConfig[run.state], stalled: true };
  }
  return { ...runStateConfig[run.state], stalled: false };
}

/** One section per kind. The bubble says how that kind fails, because that is
 * what decides where to look when its row turns red. */
export const jobKindConfig: Record<
  JobKind,
  { title: string; icon: string; info: string }
> = {
  triggered: {
    title: "Na żądanie",
    icon: mdiGestureTap,
    info: "Jedno uruchomienie na każdą zapisaną stronę; psuje się po jednej stronie naraz - błędem albo stroną, która utknęła i której nic już nie podejmie.",
  },
  scheduled: {
    title: "Według harmonogramu",
    icon: mdiCalendarClock,
    info: "Ruszają o stałej porze; psują się błędem albo po cichu - nie startując wcale, co zauważa dopiero zegar tej strony.",
  },
  ongoing: {
    title: "Ciągłe",
    icon: mdiAutorenew,
    info: "Długie przebiegi, które opróżniają kolejkę; psują się, milknąc, choć wciąż twierdzą, że pracują.",
  },
};

/** The section for runs reported under ids `JOBS` does not know. */
export const otherJobsConfig = {
  title: "Inne",
  info: "Uruchomienia zgłoszone pod nazwą, której ta strona nie zna. Żeby dostały opis i harmonogram, dopisz je do JOBS w shared/jobs.ts.",
};

export const runTriggerConfig: Record<
  RunTrigger,
  { title: string; icon: string }
> = {
  schedule: { title: "harmonogram", icon: mdiCalendarClock },
  manual: { title: "ręcznie", icon: mdiConsoleLine },
  event: { title: "zdarzenie", icon: mdiLightningBoltOutline },
};

/** The two jobs that report nothing, and where their state is read from. */
export const jobProbeConfig: Record<
  JobProbe,
  { title: string; source: string }
> = {
  compressedMirror: {
    title: "Lustro w koryta-pl-compressed",
    source:
      "Kompresor nie zgłasza uruchomień - jego stan to najnowsze archiwum każdego hosta w koryta-pl-compressed.",
  },
  firestoreExport: {
    title: "Ostatnia kopia w koryta-pl-crawled",
    source:
      "Eksport nie zgłasza uruchomień - jego stan to plik końcowy (.overall_export_metadata) najnowszej kopii w koryta-pl-crawled.",
  },
};

/** What a job that should report and has not says in its open row. */
export const NO_RUNS_YET =
  "Ten job jeszcze nic nie zgłosił. Zgłasza się sam przez data/pipelines/src/stores/job_runs.py.";

/** The counters the jobs write, as they read after "label: ". A key nobody
 * has named yet shows as itself - still better than hiding it. */
const COUNTER_LABELS: Record<string, string> = {
  answered: "z odpowiedzią",
  empty: "puste",
  failed: "nieudane",
  upload_failed: "niezapisane",
  bulletin_fetched: "dni biuletynu",
  bulletin_failed: "dni biuletynu bez odpowiedzi",
  facts: "faktów",
  bought: "kupionych",
  skipped: "pominiętych",
  pln: "zł",
  pln_planned: "zł w planie",
  stored: "zapisanych stron",
  errors: "błędów",
  not_html: "nie HTML",
  rate_limited: "wstrzymanych przez limit",
  discovered: "odkrytych adresów",
  // krs_odpis: one per company, how its odpis came back.
  fetched: "pobranych",
  absent: "brak w rejestrze",
  gateway: "bramka 504",
  network: "błędy sieci",
  // krs_register_owners: one per register entry read.
  ok: "odczytanych",
  struck_off: "wykreślonych",
  not_found: "nieznalezionych",
  logged: "zapisanych w logu",
};

/** The counter keys the jobs in this repository write, so a test can check
 * that every one of them reads in Polish. */
export const KNOWN_COUNTERS = Object.keys(COUNTER_LABELS);

export const counterLabel = (key: string) => COUNTER_LABELS[key] ?? key;

/** Money keeps its grosze; every other counter is a count. */
export const counterValue = (key: string, value: number) =>
  key === "pln" || key === "pln_planned"
    ? new Intl.NumberFormat("pl-PL", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value)
    : formatCount(value);

/** The pill classes for a tone, the same pairs `AdminExpandRow` uses. */
export const toneClasses = (tone: RowTone) =>
  tone === "neutral" || tone === "strong"
    ? "bg-surface-muted text-ink-neutral"
    : `bg-surface-${tone} text-ink-${tone}`;

/** Polish plural after a number: 1 fakt, 3 fakty, 5 faktów, 22 fakty. */
export function plural(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  if (count === 1) return one;
  const rest = count % 10;
  const teens = count % 100;
  return Number.isInteger(count) &&
    rest >= 2 &&
    rest <= 4 &&
    (teens < 12 || teens > 14)
    ? few
    : many;
}

/** How far a run has got. `short` is the row's header - `1200/5000 firm` -
 * and the long form the run list's `1200 z 5000 firm`. Without a total there
 * is only the count, unit first: the jobs give their unit in the genitive
 * plural that follows "z 5000", and "18 342 stron" would be wrong Polish
 * where "stron: 18 342" is not. */
export function progressText(
  progress: RunProgress,
  form: "short" | "long" = "long",
): string {
  const unit = progress.unit ? ` ${progress.unit}` : "";
  if (progress.total === null) {
    return progress.unit
      ? `${progress.unit}: ${formatCount(progress.done)}`
      : formatCount(progress.done);
  }
  const joint = form === "short" ? "/" : " z ";
  return `${formatCount(progress.done)}${joint}${formatCount(progress.total)}${unit}`;
}

/** Done over total, 0-1; null when there is no total to measure against. */
export function progressShare(progress: RunProgress): number | null {
  if (progress.total === null) return null;
  if (progress.total <= 0) return progress.done > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, progress.done / progress.total));
}

/** An archive's size, in the unit the bucket browser shows. */
export const formatMegabytes = (bytes: number) =>
  `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} MB`;

/** "codziennie o 00:30 czasu warszawskiego" - the zone named the way the
 * owner reads it, and any other one by its IANA name. */
export function scheduleText(definition: Pick<JobDefinition, "schedule">) {
  const schedule = definition.schedule;
  if (!schedule) return null;
  const zone =
    schedule.timeZone === WARSAW
      ? "czasu warszawskiego"
      : `(${schedule.timeZone})`;
  return `codziennie o ${schedule.dailyAt} ${zone}`;
}

/** A definition for a job `JOBS` does not list, so its runs can be shown and
 * judged like any other. Its kind is guessed from how its newest run started:
 * a site event means triggered, anything else is read as a scheduled job with
 * no schedule - plain succeeded / partial / failed, with no clock to miss. An
 * unknown job read as ongoing would turn amber after every finished run. */
export function otherDefinition(view: JobView): JobDefinition {
  const kind: JobKind =
    view.runs[0]?.trigger === "event" ? "triggered" : "scheduled";
  return {
    id: view.id,
    kind,
    title: view.id,
    summary:
      "Zgłasza uruchomienia, ale nie ma go w rejestrze jobów (JOBS w shared/jobs.ts), więc nie ma opisu ani harmonogramu.",
    runsOn: view.runs[0]?.host ?? "nie wiadomo",
    heartbeatMinutes: 15,
  };
}

/** The anchor a row is reached by: `/admin/procesy#proces-<id>`. */
export const jobAnchor = (id: string) => `proces-${id}`;
