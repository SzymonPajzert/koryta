/** Jobs: the things that change the data - the KRS scrapes, the mirror maker,
 * the article crawl, the imports into the site, the extension's extractions -
 * and how far each one has got.
 *
 * They used to run on the owner's laptop and home server, where "is it still
 * going" meant opening a terminal. As they move to Cloud Run and Cloud
 * Scheduler that terminal goes away, so every job reports its runs to one
 * place and /admin/procesy reads them back.
 *
 * Three kinds, because each fails differently:
 * - `triggered`: one run per request - a page captured by the extension and
 *   read by the extractor, or a one-off import someone starts by hand. No
 *   clock is waiting for it, so it fails by breaking or by getting stuck.
 * - `scheduled`: a run at a set time - the night on the VM at 04:30. Fails by
 *   breaking, or silently by never starting, which only a clock can notice.
 * - `ongoing`: a long run that drains a queue - the article crawl. Fails by
 *   going quiet while still claiming to run.
 *
 * Where the runs come from:
 * - Reported runs are `jobRuns/{runId}` documents in the ops database
 *   (`OPS_DATABASE`, next to the task list), plus one `jobs/{jobId}` document
 *   per job holding what a short history would lose: when it last ran on its
 *   schedule and when it last succeeded. The jobs write them themselves
 *   (`data/pipelines/src/stores/job_runs.py`), so a run is visible while it is
 *   going, from whatever machine it runs on. IAM narrows a writer to that
 *   database, which holds nothing but ops data.
 * - Captures are already job documents: `articlePages` in the site's database,
 *   with their own `stored -> extracting -> done | error` lifecycle
 *   (shared/capture.ts). The server maps them onto the one job marked
 *   `captures`, rather than copying them.
 * - A run somebody asks for on a page - "send this company's people" - starts
 *   as a `jobRuns` document the site writes itself, `queued`, with what was
 *   asked in `request` (server/utils/jobRequests.ts). The job that takes it on
 *   reports on that same document, so its link (`/admin/procesy#przebieg-<id>`)
 *   follows it from the click to its end.
 * - Two jobs report nothing and are watched through what they leave behind:
 *   the compressor through the newest archive in koryta-pl-compressed, the
 *   Firestore export through its completion marker in koryta-pl-crawled.
 *
 * The registry below is what makes a silent failure visible: a job that is
 * meant to exist shows up whether or not it has ever reported.
 *
 * Plain data and pure functions, shared by the page and the server route.
 */
import { z } from "zod";
import type { ArticleCapture } from "./capture";

export const JOBS_COLLECTION = "jobs";
export const JOB_RUNS_COLLECTION = "jobRuns";

/** The job a company's or a person's page asks for: their people, sent to the
 * site (`koryta_people_import --request`, data/pipelines/src/jobs/requests). */
export const PEOPLE_REQUEST = "people_request";

/** Where a run is reached: `/admin/procesy#przebieg-<id>`. A capture is a run
 * too, under its `articlePages` id. */
export const runAnchor = (id: string) => `przebieg-${id}`;
export const runLink = (id: string) => `/admin/procesy#${runAnchor(id)}`;

export const JOB_KINDS = ["triggered", "scheduled", "ongoing"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** What a run reports about itself.
 * - `queued`: accepted, nothing has picked it up yet (a capture waiting for
 *   the extractor).
 * - `running`: going; `heartbeatAt` says when it last said so.
 * - `succeeded`: finished everything it set out to do.
 * - `partial`: stopped cleanly with work left - a deadline, a SIGTERM, a
 *   backlog bigger than one night. The next run carries on. This is what the
 *   jobs' exit code 75 means when the upstream is fine.
 * - `failed`: broke, or the upstream refused it.
 *
 * The job decides which of the last three it was, not the exit code: 75 means
 * "backlog remains" in some jobs and "upstream refusing" in others. */
export const RUN_STATES = [
  "queued",
  "running",
  "succeeded",
  "partial",
  "failed",
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const isFinished = (state: RunState) =>
  state === "succeeded" || state === "partial" || state === "failed";

/** How a run started: Cloud Scheduler, someone at a terminal, an event on
 * the site (a capture), or somebody asking for it on a page. */
export const RUN_TRIGGERS = ["schedule", "manual", "event", "request"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export interface RunProgress {
  done: number;
  /** Null when the job cannot know how much there is, like the crawl. */
  total: number | null;
  /** Polish, plural genitive as it reads after a number: "firm", "stron". */
  unit: string;
}

/** One run, reported or mapped from a capture. Times are ISO strings. */
export interface JobRun {
  id: string;
  job: string;
  state: RunState;
  trigger: RunTrigger | null;
  /** Where it ran: `cloud-run:krs-scrape-free/<execution>`, `predator`. */
  host: string | null;
  startedAt: string;
  /** Last sign of life. Equal to `finishedAt` once it has finished. */
  heartbeatAt: string;
  finishedAt: string | null;
  progress: RunProgress | null;
  /** Job-specific tallies: answered, empty, failed, pln... */
  counters: Record<string, number>;
  /** What it is doing now: "biuletyn", "odpisy". */
  phase: string | null;
  /** Why it stopped: "deadline", "20 requests in a row failed". */
  stopReason: string | null;
  errors: string[];
  exitCode: number | null;
  /** The durable record of the run, when the job writes one -
   * `gs://koryta-pl-sharedcache/jobs/<job>/runs/date=<day>/<run>.json`. */
  summaryPath: string | null;
  /** Code version, when the job knows it. */
  version: string | null;
  /** What the run is about, when it is about one thing: the page a capture
   * read, the company a request named. `link` is that thing on the site. */
  title?: string | null;
  url?: string | null;
  link?: string | null;
  /** A run asked for on a page: what was asked, and by whom. */
  request?: RunRequest | null;
  /** A run asked for on a page: what came of starting the machine for it. */
  dispatch?: RunDispatch | null;
}

/** What somebody asked for, on the page of a company or a person. */
export interface RunRequest {
  target: RequestTarget;
  nodeId: string;
  name: string;
  /** A company's KRS number. */
  krs?: string | null;
  /** A person's rejestr.io link. */
  rejestrIo?: string | null;
  /** Build and count, send nothing. */
  dryRun: boolean;
  /** Who asked: their uid, and a name to show. */
  by?: string | null;
  byName?: string | null;
  at?: string | null;
}

export const REQUEST_TARGETS = ["company", "person"] as const;
export type RequestTarget = (typeof REQUEST_TARGETS)[number];

/** Starting the machine that does the asked-for runs (server/utils/jobRunner.ts):
 * `vm` when the site starts it, `off` when the run waits for the night. */
export interface RunDispatch {
  mode: "vm" | "off";
  at: string;
  ok: boolean;
  error?: string | null;
}

/** Errors and their length are capped where they are written; these caps
 * apply again on read, so one oversized document cannot flood the page. */
export const RUN_ERRORS_KEPT = 20;
export const RUN_ERROR_CHARS = 500;

/** A time as an ISO string, from any spelling `Date` reads. One it cannot
 * read is no time at all: kept as it was, it threw "Invalid time value" out of
 * every status line that named it, and as a heartbeat it never aged, so its
 * run could not stall. Normalised so runs sort by string. */
const isoTime = z.string().transform((value, ctx) => {
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "not a time" });
    return z.NEVER;
  }
  return new Date(millis).toISOString();
});

const isoOrNull = isoTime.nullish().transform((value) => value ?? null);

const runDataSchema = z.object({
  job: z.string().min(1),
  state: z.enum(RUN_STATES),
  trigger: z.enum(RUN_TRIGGERS).nullish().catch(null),
  host: z.string().nullish().catch(null),
  startedAt: isoTime,
  heartbeatAt: isoOrNull.catch(null),
  finishedAt: isoOrNull.catch(null),
  progress: z
    .object({
      done: z.number().finite().nonnegative(),
      total: z.number().finite().nonnegative().nullish(),
      unit: z.string().nullish(),
    })
    .nullish()
    .catch(null),
  counters: z.record(z.string(), z.unknown()).nullish().catch(null),
  phase: z.string().nullish().catch(null),
  stopReason: z.string().nullish().catch(null),
  errors: z.array(z.unknown()).nullish().catch(null),
  exitCode: z.number().int().nullish().catch(null),
  summaryPath: z.string().nullish().catch(null),
  version: z.string().nullish().catch(null),
  title: z.string().nullish().catch(null),
  link: z.string().nullish().catch(null),
  request: z
    .object({
      target: z.enum(REQUEST_TARGETS),
      nodeId: z.string().min(1),
      name: z.string().catch(""),
      krs: z.string().nullish().catch(null),
      rejestrIo: z.string().nullish().catch(null),
      dryRun: z.boolean().catch(false),
      by: z.string().nullish().catch(null),
      byName: z.string().nullish().catch(null),
      at: isoOrNull.catch(null),
    })
    .nullish()
    .catch(null),
  dispatch: z
    .object({
      mode: z.enum(["vm", "off"]),
      at: isoTime,
      ok: z.boolean(),
      error: z.string().nullish().catch(null),
    })
    .nullish()
    .catch(null),
});

/** A reported run as the page uses it, from a document's data with its times
 * already turned into ISO strings. Null when the essentials are missing - a
 * run with no job, state or start cannot be placed anywhere - and lenient
 * about the rest, because the writers are Python jobs on several machines and
 * one bad field should not hide the run. */
export function jobRunFromData(id: string, data: unknown): JobRun | null {
  const parsed = runDataSchema.safeParse(data);
  if (!parsed.success) return null;
  const run = parsed.data;
  const counters: Record<string, number> = {};
  for (const [key, value] of Object.entries(run.counters ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) {
      counters[key] = value;
    }
  }
  return {
    id,
    job: run.job,
    state: run.state,
    trigger: run.trigger ?? null,
    host: run.host ?? null,
    startedAt: run.startedAt,
    heartbeatAt: run.heartbeatAt ?? run.finishedAt ?? run.startedAt,
    finishedAt: run.finishedAt,
    progress: run.progress
      ? {
          done: run.progress.done,
          total: run.progress.total ?? null,
          unit: run.progress.unit ?? "",
        }
      : null,
    counters,
    phase: run.phase ?? null,
    stopReason: run.stopReason ?? null,
    errors: (run.errors ?? [])
      .filter((error): error is string => typeof error === "string")
      .slice(0, RUN_ERRORS_KEPT)
      .map((error) => error.slice(0, RUN_ERROR_CHARS)),
    exitCode: run.exitCode ?? null,
    summaryPath: run.summaryPath ?? null,
    version: run.version ?? null,
    // Only where a run is about one thing; the rest of the jobs leave them out
    // rather than carry three nulls each.
    ...(run.title ? { title: run.title } : {}),
    ...(run.link ? { link: run.link } : {}),
    ...(run.request
      ? {
          request: {
            ...run.request,
            krs: run.request.krs ?? null,
            rejestrIo: run.request.rejestrIo ?? null,
            by: run.request.by ?? null,
            byName: run.request.byName ?? null,
            at: run.request.at ?? null,
          },
        }
      : {}),
    ...(run.dispatch
      ? { dispatch: { ...run.dispatch, error: run.dispatch.error ?? null } }
      : {}),
  };
}

/** Newest first, by start; the id (a uuid7, which sorts by time) breaks ties. */
export function compareRunsNewest(a: JobRun, b: JobRun): number {
  return b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id);
}

/** A daily run at a wall-clock time in a zone. Daily is all any job needs so
 * far; a weekly one would add a weekday here. */
export interface JobSchedule {
  /** `HH:MM`, in `timeZone`. */
  dailyAt: string;
  timeZone: string;
}

export type JobProbe = "compressedMirror" | "firestoreExport";

export interface JobDefinition {
  id: string;
  kind: JobKind;
  /** Its runs are the extension's captures, mapped from `articlePages`
   * (`captureRun`), not runs it reports. A stream of pages, judged by every
   * page in the last week - one can be stuck while newer ones go through -
   * and listed by what each captured. A triggered job without it, an import
   * started by hand, is as good as its newest run. */
  captures?: true;
  /** Its `partial` is work held back for somebody to look at, not a backlog
   * the next run carries on with. The night is the one: its steps leave
   * their backlogs to the next night without making it partial, and it ends
   * partial only when it held a step - the people kept off the site by a
   * test that broke, or by a missing export - or was stopped. */
  partialIsHeld?: true;
  title: string;
  /** One or two sentences: what it does and what it changes. */
  summary: string;
  /** Where it runs, or is meant to. */
  runsOn: string;
  /** How to start it by hand. */
  command?: string;
  schedule?: JobSchedule;
  /** Said instead of a time when the job has none yet, and why. */
  scheduleNote?: string;
  /** A run that has said nothing for this long has stalled. Jobs heartbeat
   * every minute or so while they work, so this is a few missed beats plus
   * the longest single step. */
  heartbeatMinutes: number;
  /** A capture nobody has picked up for this long is stuck. */
  queuedMinutes?: number;
  /** How late a scheduled start may be before it counts as missed. */
  graceMinutes?: number;
  probe?: JobProbe;
  /** compressedMirror: the hosts whose archives the pipelines read. */
  mirrorHosts?: string[];
  /** compressedMirror: which jobs write each host's objects to the crawl
   * bucket. A host nothing has written to since its newest archive is not
   * behind, however old that archive is: the compressor only archives what
   * is new, so rejestr.io, written by a paid job run by hand, would otherwise
   * read stale every week the job is not run. */
  mirrorWriters?: Record<string, string[]>;
  /** compressedMirror: how many days behind the mirror may fall. It always
   * lags at least a day: the compressor skips objects dated today (UTC). */
  maxLagDays?: number;
  /** Task-list ids (/admin/zadania#t-<id>) for what is still to do. */
  tasks?: string[];
  /** Anything else worth knowing on the page. */
  notes?: string[];
}

export const WARSAW = "Europe/Warsaw";

/** The jobs the page knows about, in the order it lists them. A run
 * reported under any other id still shows, under "Inne", so nothing a job
 * writes is hidden by this list being out of date. */
export const JOBS: readonly JobDefinition[] = [
  {
    id: "capture_extraction",
    kind: "triggered",
    captures: true,
    title: "Zapis artykułu z rozszerzenia",
    summary:
      "Rozszerzenie (albo „Wklej treść” na /zrodla) zapisuje stronę w archiwum crawla, a capture-extractor wyciąga z niej fakty do /ekstrakcje.",
    runsOn:
      "App Hosting, kolejka Cloud Tasks article-extraction i Cloud Run capture-extractor",
    heartbeatMinutes: 35,
    queuedMinutes: 15,
    tasks: ["merge-capture-match-people"],
    notes: [
      "Ekstrakcja ma 30 minut (dispatchDeadline kolejki); strona, która tyle stoi w „przetwarzam”, utknęła i nic jej już nie podejmie.",
    ],
  },
  // The imports report one run per `koryta_uploader --submit`, under the id
  // of the payload type they send. A person upload reports as people_import,
  // which also has a daily run of its own, so it sits with the scheduled jobs.
  // score_import is a step of the night too (koryta_score_import), but the
  // night's own row is what says a night did not run it; this one is judged
  // by its newest run, as before.
  {
    id: "company_import",
    kind: "triggered",
    title: "Import firm",
    summary:
      "koryta_uploader --type company: firmy z CompaniesPayloads przez /api/ingest/company.",
    runsOn: "Ręcznie",
    command:
      "koryta CompaniesPayloads --output stdout | koryta_uploader --type company --submit",
    heartbeatMinutes: 15,
  },
  {
    id: "score_import",
    kind: "triggered",
    title: "Oceny modeli",
    summary:
      "Krótka lista każdego modelu oceniającego osoby jako głosy pod jego własnym uid: zmienione oceny zapisuje, a tym, których model już nie ocenia, je wycofuje. Z tych głosów kolejka /eksploruj/nowe bierze kolejność i próg.",
    runsOn:
      "Krok nocy na VM koryta-nightly (koryta_nightly), po imporcie osób; ręcznie ./submit_scores.sh prod",
    command: "koryta_score_import",
    heartbeatMinutes: 15,
    notes: [
      "Modele oceniają też strony utworzone tej nocy przez import osób, choć kopii bazy z 04:00 jeszcze ich nie ma - nowa osoba trafia do kolejki tego samego ranka.",
      "Model, który nikogo nie ocenił, nie jest wysyłany: wycofałby wszystkie swoje głosy.",
    ],
  },
  {
    id: "extraction_import",
    kind: "triggered",
    title: "Import faktów z artykułów",
    summary:
      "koryta_uploader --type extraction: fakty z wsadowej ekstrakcji artykułów, jednym żądaniem do /api/ingest/extraction.",
    runsOn: "Ręcznie",
    heartbeatMinutes: 15,
  },
  {
    id: PEOPLE_REQUEST,
    kind: "triggered",
    title: "Wysyłka osób na żądanie",
    summary:
      "Przycisk na stronie firmy albo osoby: paczki jej ludzi - albo tej jednej osoby - z najnowszych danych, wysłane przez /api/ingest/person. Osobom spółki, których serwis nie ma, zakłada strony (nieopublikowane); osobie nie zakłada żadnej.",
    runsOn:
      "VM koryta-nightly, którą strona włącza na żądanie (koryta-requests.service); bez tego - w nocy",
    command: "koryta_job_requests --once",
    // Building the payloads says nothing until it is done: the export and
    // the company's people are read in one step.
    heartbeatMinutes: 45,
    // The VM boots in a minute or two; a run nobody takes for half an hour
    // was not given a machine.
    queuedMinutes: 30,
    tasks: ["grant-site-starts-nightly-vm", "install-koryta-requests-worker"],
    notes: [
      "Porównuje paczki z porannym eksportem bazy: wysyła tylko to, co zmieniłoby stronę, i nie zgaduje po samym nazwisku, gdy dwie osoby się nie odróżniają.",
      "Maszyna wyłącza się sama 10 minut po ostatniej wysyłce - chyba że ktoś jest zalogowany albo zaraz zacznie się noc.",
    ],
  },
  {
    id: "nightly",
    kind: "scheduled",
    partialIsHeld: true,
    title: "Noc na maszynie koryta-nightly",
    summary:
      "Po kolei, po kopii bazy z 04:00: uzupełnia lustro KRS, czeka na tę kopię, pobiera bezpłatne KRS i odpisy, dokupuje z rejestr.io to, czego nie dały (do 50 zapytań), przelicza wszystkie potoki (kopie w pamięci podręcznej jako main), puszcza testy i niezmienniki, wysyła do 100 osób na stronę, a potem oceny modeli.",
    runsOn:
      "VM koryta-nightly (europe-central2): harmonogram włącza ją o 04:15, a po pracy sama się wyłącza - data/nightly",
    command: "koryta_nightly",
    schedule: { dailyAt: "04:30", timeZone: WARSAW },
    // Przeliczenie potoków to jeden krok do dwóch i pół godziny, w którym noc
    // nie daje znaku życia.
    heartbeatMinutes: 160,
    graceMinutes: 30,
    tasks: ["merge-nightly-vm", "create-nightly-vm", "first-night-on-the-vm"],
    notes: [
      "Krok, który się nie uda, nie kończy nocy - wstrzymuje tylko kroki zależne. Osób nie wysyła bez dzisiejszej kopii bazy, bez udanego przeliczenia albo gdy test, który przechodził poprzedniej nocy, dziś nie przechodzi - taka noc kończy się jako „Wstrzymane kroki” i wymaga uwagi.",
      "Podsumowanie każdej nocy jest w koryta-pl-sharedcache/jobs/nightly/runs/, a cały log w jobs/nightly/logs/.",
    ],
  },
  {
    id: "krs_scrape_free",
    kind: "scheduled",
    title: "Bezpłatne pobieranie KRS",
    summary:
      "Biuletyn KRS z ostatnich dni i odpisy aktualne z api-krs dla firm z kolejki ScrapeRejestrIO; odpowiedzi trafiają do archiwum crawla.",
    runsOn:
      "Krok nocy na VM koryta-nightly (koryta_nightly), zaraz po kopii bazy z 04:00",
    command: "koryta_scrape_krs_free --max-minutes=60",
    schedule: { dailyAt: "04:30", timeZone: WARSAW },
    heartbeatMinutes: 15,
    graceMinutes: 60,
    tasks: ["create-nightly-vm"],
    notes: [
      "Po godzinie przestaje pytać, a zaległości zostawia na następną noc (wtedy „niedokończony”, nie błąd).",
    ],
  },
  {
    id: "krs_scrape_paid",
    kind: "scheduled",
    title: "Zapytania do rejestr.io (płatne)",
    summary:
      "Co noc kupuje z rejestr.io tylko to, czego nie dały bezpłatne źródła: powiązania osób oznaczonych jako interesujące i firm, których odpisu pełnego nie udało się pobrać - po 0,05 zł za zapytanie, najwyżej 50 zapytań dziennie.",
    runsOn:
      "Krok nocy na VM koryta-nightly (koryta_nightly), po odpisach, a przed przeliczeniem potoków; ręcznie cała kolejka, z pytaniem przed każdym zakupem",
    command: "koryta_scrape_krs_paid --scope fallback --max-calls 50",
    schedule: { dailyAt: "04:30", timeZone: WARSAW },
    heartbeatMinutes: 15,
    // Rusza po bezpłatnym KRS i odpisach, zwykle kwadrans po starcie nocy.
    graceMinutes: 90,
    tasks: [
      "decide-rejestrio-budget",
      "add-rejestr-io-key-secret",
      "merge-nightly-rejestrio-fallback",
    ],
    notes: [
      "Limit jest dzienny: liczy też to, co tego dnia kupiło wcześniejsze uruchomienie. Co zostawi na jutro, kończy uruchomienie jako „niedokończony”; odmowa konta (zły klucz, brak środków) - jako błąd.",
      "Bez klucza rejestr.io (sekret rejestr-io-key) krok nocy jest pomijany i nic nie zgłasza.",
    ],
  },
  {
    id: "krs_odpis",
    kind: "scheduled",
    title: "Odpisy pełne z wyszukiwarki KRS",
    summary:
      "Pobiera bezpłatne odpisy pełne (PDF) z ministerialnej wyszukiwarki KRS - dla firm z kolejki, z pliku albo z grafu - i z nich bierze daty, od kiedy i do kiedy kto zasiadał w zarządach.",
    runsOn: "Ręcznie na predatorze - jeden crawler na adres IP",
    command: "koryta_krs_odpis --graph --changed-since <dzień>",
    scheduleNote:
      "Cotygodniowe odświeżenie firm z biuletynu (--graph --changed-since) - pora do ustalenia",
    heartbeatMinutes: 15,
    notes: [
      "Kończy się sam, gdy wyszukiwarka zwalnia albo przestaje odpowiadać; resztę bierze następne uruchomienie (wtedy „niedokończony”). 20 prób z rzędu bez odpowiedzi to błąd.",
    ],
  },
  {
    id: "krs_register_owners",
    kind: "scheduled",
    title: "Przegląd rejestru KRS (właściciele)",
    summary:
      "Czyta po kolei odpisy aktualne z api-krs dla całego biuletynu, szukając spółek samorządów i Skarbu Państwa, do których nie prowadzi żadne inne wejście crawla.",
    runsOn: "Ręcznie, partiami",
    command: "koryta_krs_register_owners --reads 20000",
    scheduleNote: "Tempo i miejsce do ustalenia (zostało ok. 690 tys. wpisów)",
    heartbeatMinutes: 15,
    tasks: ["import-register-sweep-to-log", "decide-register-sweep-pace"],
  },
  {
    id: "compressor",
    kind: "scheduled",
    title: "Kompresja lustra KRS",
    summary:
      "Pakuje nowe odpowiedzi rejestr.io i api-krs z archiwum crawla do koryta-pl-compressed; potoki czytają te hosty tylko z lustra.",
    runsOn: "Pierwszy krok nocy na VM koryta-nightly (koryta_nightly), o 04:30",
    command:
      "go run ./cmd/compressor -incremental -hostname rejestr.io (i -hostname api-krs.ms.gov.pl)",
    scheduleNote:
      "Co noc, na początku nocy - po północy UTC bierze cały poprzedni dzień; uruchomień jeszcze nie raportuje",
    heartbeatMinutes: 30,
    probe: "compressedMirror",
    mirrorHosts: ["rejestr.io", "api-krs.ms.gov.pl"],
    mirrorWriters: {
      "rejestr.io": ["krs_scrape_paid"],
      "api-krs.ms.gov.pl": ["krs_scrape_free"],
    },
    maxLagDays: 2,
    tasks: ["compressor-reports-runs", "create-nightly-vm"],
    notes: [
      "Stan bierze się z nazw archiwów, bo kompresor nie raportuje uruchomień. Pomija obiekty z bieżącej doby UTC, więc lustro zawsze jest co najmniej dzień w tyle.",
    ],
  },
  {
    id: "firestore_export",
    kind: "scheduled",
    title: "Kopia bazy Firestore",
    summary:
      "Funkcja scheduledFirestoreExport zapisuje dziewięć kolekcji do koryta-pl-crawled; z tej kopii czytają potoki, nocne testy i agenci.",
    runsOn: "Cloud Functions (europe-west1)",
    schedule: { dailyAt: "04:00", timeZone: WARSAW },
    heartbeatMinutes: 120,
    graceMinutes: 60,
    probe: "firestoreExport",
    notes: [
      "Noc na VM rusza o 04:30 i porównuje osoby właśnie z tą kopią, więc czeka, aż eksport się skończy.",
      "Stan bierze się z pliku .overall_export_metadata, który eksport zapisuje na końcu.",
    ],
  },
  {
    id: "people_import",
    kind: "scheduled",
    title: "Import osób na stronę",
    summary:
      "Buduje paczki osób z najnowszych danych KRS i kopii bazy i wysyła je przez /api/ingest/person - w nocy najwyżej 100: najpierw świeżo zatrudnionych w spółkach publicznych, których na stronie nie ma, potem zmiany na stronach opublikowanych, potem na pozostałych.",
    runsOn:
      "Krok nocy na VM koryta-nightly (koryta_nightly), po przeliczeniu potoków i testach; ręcznie koryta_people_import",
    command: "koryta_people_import --scope priority --max-uploads 100",
    scheduleNote:
      "Co noc, gdy dzisiejsza kopia bazy, przeliczenie potoków i testy na to pozwalają (wiersz „Noc na maszynie koryta-nightly”)",
    // Building the payloads is one long step that says nothing until it is
    // done; only the upload after it heartbeats.
    heartbeatMinutes: 60,
    graceMinutes: 60,
    tasks: ["create-nightly-vm", "go-live-people-import"],
    notes: [
      "Porównuje paczki z dzisiejszą kopią bazy: wysyła tylko osoby, którym import zmieniłby coś na stronie, i nie wysyła drugi raz tej samej paczki przez 30 dni.",
      "Strony tworzy tylko świeżo zatrudnionym; strona utworzona komuś, kto według kopii już ją ma, zatrzymuje import jako błąd.",
      "W dni próbne (--dry-run) niczego nie wysyła: uruchomienie kończy się jako „próba - nic nie wysłano”, a „w paczce” mówi, ile osób poszłoby na stronę.",
    ],
  },
  {
    id: "article_crawl",
    kind: "ongoing",
    title: "Crawl artykułów",
    summary:
      "Pobiera artykuły z portali według kolejki w Postgresie i zapisuje je partiami do archiwum crawla.",
    runsOn: "Ręcznie - ostatnio u mp; kolejka w Postgresie poza repozytorium",
    command: "koryta_crawl",
    heartbeatMinutes: 15,
    tasks: ["decide-article-crawl-restart"],
    notes: [
      "Ostatnia partia w archiwum jest z 26 sierpnia 2026 (z notatek, sprzed raportowania).",
    ],
  },
];

export const jobDefinition = (id: string) => JOBS.find((job) => job.id === id);

/** What a job's own document keeps. A short history of runs cannot answer
 * "has this ever run on its schedule" or "when did it last work". */
export interface JobRecord {
  lastRunId: string | null;
  lastStartedAt: string | null;
  lastScheduledAt: string | null;
  lastSucceededAt: string | null;
}

export interface MirrorHostState {
  host: string;
  /** The newest archive's `date=`: the last day the mirror covers. */
  through: string | null;
  archivedAt: string | null;
  bytes: number | null;
  /** The Warsaw day of the oldest reported run of a job writing this host
   * that started after `through` - data the mirror does not have yet. Null
   * when the writers have reported and none ran since; absent when none of
   * them has reported at all, and the mirror's age is all there is to go
   * on. Filled in per request from the reported runs (`mirrorWrites`). */
  newerData?: string | null;
}

export interface ExportState {
  /** The export's folder, `date=<UTC ISO timestamp>`. */
  folder: string;
  startedAt: string;
  /** When the completion marker was written; null while it is going, or if
   * it died. */
  finishedAt: string | null;
}

export type ProbeResult =
  | { kind: "compressedMirror"; hosts: MirrorHostState[] }
  | { kind: "firestoreExport"; latest: ExportState | null }
  | { kind: JobProbe; error: string };

/** Captures over the last week, for the captures job's row. */
export interface CaptureStats {
  since: string;
  byState: Record<RunState, number>;
}

/** One job as the server sends it. The definition is not repeated: the page
 * has `JOBS`. */
export interface JobView {
  id: string;
  runs: JobRun[];
  record: JobRecord | null;
  /** The source of this job's runs could not be read, so an empty `runs`
   * says nothing - not that the job never ran. */
  unavailable?: boolean;
  probe?: ProbeResult | null;
  captureStats?: CaptureStats | null;
}

export interface JobsOverview {
  generatedAt: string;
  jobs: JobView[];
  /** Runs reported under ids the registry does not know. */
  others: JobView[];
  /** Sources the server could not read. The rest of the page still comes
   * back, so one missing grant does not hide every other job. */
  problems: string[];
}

/** Runs of one job the page shows. */
export const RUNS_SHOWN = 10;

/** How far back the captures are counted and judged: the week's numbers in
 * the row, and which stuck captures still count as a problem. */
export const CAPTURE_WINDOW_DAYS = 7;

/** A capture as one run of the captures job. */
export function captureRun(capture: ArticleCapture): JobRun {
  const state: RunState =
    capture.status === "extracting"
      ? "running"
      : capture.status === "done"
        ? "succeeded"
        : capture.status === "error"
          ? "failed"
          : "queued";
  const extraction = capture.extraction;
  const facts = extraction?.factCount;
  const finished = isFinished(state);
  return {
    id: capture.id,
    job: "capture_extraction",
    state,
    trigger: "event",
    host: capture.source === "paste" ? "wklejone na /zrodla" : "rozszerzenie",
    startedAt: capture.capturedAt,
    heartbeatAt: capture.updatedAt || capture.capturedAt,
    finishedAt: finished
      ? extraction?.finishedAt || capture.updatedAt || null
      : null,
    progress: null,
    counters: typeof facts === "number" ? { facts } : {},
    phase: state === "running" ? "ekstrakcja" : null,
    stopReason: null,
    errors: extraction?.error
      ? [extraction.error.slice(0, RUN_ERROR_CHARS)]
      : [],
    exitCode: null,
    summaryPath: null,
    version: extraction?.model ?? extraction?.tag ?? null,
    title: capture.title || capture.domain,
    url: capture.url,
    // Same rule as CaptureStatus: only link where there is something to read.
    link:
      state === "succeeded" && facts
        ? `/ekstrakcje?article=${encodeURIComponent(capture.url)}`
        : null,
  };
}

// ---------------------------------------------------------------------------
// Time

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Minutes the zone is ahead of UTC at `at`. */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / MINUTE);
}

/** The instant a wall-clock time on a calendar day is, in a zone. Correct
 * across the DST changes, which in Warsaw happen at 02:00/03:00 and so never
 * touch a schedule at 04:00 or 04:30. */
export function zonedTime(day: string, hhmm: string, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const asUtc = Date.UTC(year!, month! - 1, date!, hour!, minute!);
  const first = asUtc - zoneOffsetMinutes(new Date(asUtc), timeZone) * MINUTE;
  // Second pass with the offset at the answer, in case the first guess fell
  // on the other side of a DST change.
  return new Date(
    asUtc - zoneOffsetMinutes(new Date(first), timeZone) * MINUTE,
  );
}

/** `YYYY-MM-DD` in a zone. */
export function zonedDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);

/** The latest scheduled start at or before `now`. */
export function previousSlot(schedule: JobSchedule, now: Date): Date {
  const today = zonedDay(now, schedule.timeZone);
  const slot = zonedTime(today, schedule.dailyAt, schedule.timeZone);
  return slot.getTime() <= now.getTime()
    ? slot
    : zonedTime(addDays(today, -1), schedule.dailyAt, schedule.timeZone);
}

/** The first scheduled start after `now`. */
export function nextSlot(schedule: JobSchedule, now: Date): Date {
  const previous = previousSlot(schedule, now);
  return zonedTime(
    addDays(zonedDay(previous, schedule.timeZone), 1),
    schedule.dailyAt,
    schedule.timeZone,
  );
}

/** A run counts for a slot if it started at most this long before it: Cloud
 * Scheduler is punctual, but a hand run just before the hour still did the
 * night's work. */
const EARLY_MINUTES = 60;
const DEFAULT_GRACE_MINUTES = 60;

/** The slot that should have produced a run by now and did not, if any.
 * `lastStart` is the newest run's start, from any trigger. */
export function missedSlot(
  schedule: JobSchedule,
  graceMinutes: number | undefined,
  lastStart: string | null,
  now: Date,
): Date | null {
  const grace = (graceMinutes ?? DEFAULT_GRACE_MINUTES) * MINUTE;
  // The newest slot whose grace has run out.
  const due = previousSlot(schedule, new Date(now.getTime() - grace));
  if (!lastStart) return due;
  return Date.parse(lastStart) >= due.getTime() - EARLY_MINUTES * MINUTE
    ? null
    : due;
}

/** Whether a run said to be going has gone quiet. */
export function isStalled(
  run: Pick<JobRun, "state" | "heartbeatAt">,
  definition: Pick<JobDefinition, "heartbeatMinutes" | "queuedMinutes">,
  now: Date,
): boolean {
  if (isFinished(run.state)) return false;
  const limit =
    run.state === "queued"
      ? (definition.queuedMinutes ?? definition.heartbeatMinutes)
      : definition.heartbeatMinutes;
  return now.getTime() - Date.parse(run.heartbeatAt) > limit * MINUTE;
}

/** Whole days from `day` to the UTC day of `now`. */
export function lagDays(day: string, now: Date): number {
  return Math.round(
    (Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${day}T00:00:00Z`)) /
      DAY,
  );
}

// ---------------------------------------------------------------------------
// Health

/** How a job is doing, worst first. */
export const JOB_HEALTH = [
  "stalled",
  "failed",
  "late",
  "held",
  "stale",
  "partial",
  "stopped",
  "running",
  "ok",
  "never",
  "unknown",
] as const;
export type JobHealthStatus = (typeof JOB_HEALTH)[number];

export interface JobHealth {
  status: JobHealthStatus;
  /** One line, Polish, saying what the status is based on. */
  detail: string;
}

/** Health that needs someone to look at it. */
export const isProblem = (status: JobHealthStatus) =>
  status === "stalled" ||
  status === "failed" ||
  status === "late" ||
  status === "held" ||
  status === "stale";

const worse = (a: JobHealth, b: JobHealth) =>
  JOB_HEALTH.indexOf(a.status) <= JOB_HEALTH.indexOf(b.status) ? a : b;

const pl = new Intl.NumberFormat("pl-PL");

/** The form a Polish noun takes after a number: 1 strona, 2 strony, 5 stron,
 * 12 stron, 22 strony. */
const counted = (n: number, one: string, few: string, many: string) => {
  if (n === 1) return one;
  const units = n % 10;
  const tens = n % 100;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
};

/** `14:05` or `2.10, 14:05`, Warsaw time - short enough for a status line. */
export function shortWarsawTime(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("pl-PL", {
    timeZone: WARSAW,
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  if (zonedDay(at, WARSAW) === zonedDay(now, WARSAW)) return time;
  const day = new Intl.DateTimeFormat("pl-PL", {
    timeZone: WARSAW,
    day: "numeric",
    month: "numeric",
  }).format(at);
  return `${day}, ${time}`;
}

/** `12 min`, `2 h 5 min`, `3 dni` - how long something took or has been. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  return `${Math.floor(hours / 24)} dni`;
}

/** Whether a host's archives are behind the data there is: something was
 * written after the newest archive, longer ago than the allowance. With no
 * reports from its writers, only the archive's own age can say. */
function hostBehind(host: MirrorHostState, maxLag: number, now: Date) {
  if (host.newerData === null) return false;
  return lagDays(host.newerData ?? host.through!, now) > maxLag;
}

function mirrorHealth(
  probe: Extract<ProbeResult, { kind: "compressedMirror" }>,
  definition: JobDefinition,
  now: Date,
): JobHealth {
  const maxLag = definition.maxLagDays ?? 2;
  const dated = probe.hosts.filter((host) => host.through);
  if (!dated.length) {
    return {
      status: "never",
      detail: "W lustrze nie ma jeszcze żadnego archiwum.",
    };
  }
  const behind = dated.filter((host) => hostBehind(host, maxLag, now));
  // The stalest host that is behind is the one that decides: a pipeline
  // reading it gets that host's answers as of that day.
  const shown = (behind.length ? behind : dated).reduce((a, b) =>
    a.through! <= b.through! ? a : b,
  );
  const lag = lagDays(shown.through!, now);
  const missing = probe.hosts.length - dated.length;
  const detail =
    `Lustro do ${shown.through} (${shown.host}), ${pl.format(lag)} ${lag === 1 ? "dzień" : "dni"} temu` +
    (shown.newerData
      ? `; nowsze dane od ${shown.newerData}`
      : shown.newerData === null && lag > maxLag
        ? " - nic nowszego do spakowania"
        : "") +
    (missing ? `; ${missing} bez archiwum` : "");
  return { status: behind.length || missing ? "stale" : "ok", detail };
}

/** `newerData` for each mirrored host, from the runs of the jobs that write
 * it (newest first, as the overview has them). A failed run may have
 * written nothing, so it does not count; a running one is writing. */
export function mirrorWrites(
  hosts: MirrorHostState[],
  writers: Record<string, string[]> | undefined,
  runsOf: (job: string) => JobRun[],
): MirrorHostState[] {
  return hosts.map((host) => {
    const jobs = writers?.[host.host] ?? [];
    const runs = jobs.flatMap(runsOf);
    if (!runs.length || !host.through) return host;
    const days = runs
      .filter((run) => run.state !== "failed" && run.state !== "queued")
      .map((run) => zonedDay(new Date(run.startedAt), WARSAW))
      .filter((day) => day > host.through!)
      .sort();
    return { ...host, newerData: days[0] ?? null };
  });
}

function exportHealth(
  probe: Extract<ProbeResult, { kind: "firestoreExport" }>,
  definition: JobDefinition,
  now: Date,
): JobHealth {
  const latest = probe.latest;
  if (latest && !latest.finishedAt) {
    // An export takes a few minutes; one without its marker after the
    // heartbeat allowance is not coming.
    return now.getTime() - Date.parse(latest.startedAt) >
      definition.heartbeatMinutes * MINUTE
      ? {
          status: "failed",
          detail: `Eksport z ${shortWarsawTime(latest.startedAt, now)} nie ma pliku końcowego.`,
        }
      : {
          status: "running",
          detail: `Eksport trwa od ${shortWarsawTime(latest.startedAt, now)}.`,
        };
  }
  const missed = definition.schedule
    ? missedSlot(
        definition.schedule,
        definition.graceMinutes,
        latest?.startedAt ?? null,
        now,
      )
    : null;
  if (missed) {
    return {
      status: "late",
      detail: `Brak kopii z ${shortWarsawTime(missed.toISOString(), now)}.`,
    };
  }
  if (!latest)
    return { status: "never", detail: "Nie znaleziono żadnej kopii." };
  return {
    status: "ok",
    detail: `Ostatnia kopia z ${shortWarsawTime(latest.startedAt, now)}, gotowa po ${formatDuration(Date.parse(latest.finishedAt!) - Date.parse(latest.startedAt))}.`,
  };
}

function probeHealth(
  probe: ProbeResult,
  definition: JobDefinition,
  now: Date,
): JobHealth {
  if ("error" in probe) {
    return {
      status: "unknown",
      detail: `Nie udało się sprawdzić: ${probe.error}`,
    };
  }
  return probe.kind === "compressedMirror"
    ? mirrorHealth(probe, definition, now)
    : exportHealth(probe, definition, now);
}

function stateDetail(run: JobRun, now: Date): string {
  const when = shortWarsawTime(run.finishedAt ?? run.heartbeatAt, now);
  const reason = run.stopReason ? ` (${run.stopReason})` : "";
  switch (run.state) {
    // A success seldom has a reason; when it does, it says what kind of
    // success it was - a trial import that sent nothing must not read as a
    // night's real upload.
    case "succeeded":
      return `Ostatnio udane: ${when}${reason}.`;
    case "partial":
      return `Przerwane z zaległościami: ${when}${reason}.`;
    case "failed":
      return `Błąd: ${when}${reason}.`;
    default:
      return "";
  }
}

/** A step a run names as held, among the lines the night reports as its
 * errors: one for each step that did not simply succeed, `<step>: <state> -
 * <reason>` (`Night.end` in data/pipelines/src/jobs/nightly). */
const HELD_STEP = /^\w+: held\b/;

/** When a run that held work back finished, and the first step it held, with
 * why. The step comes from its errors before its stop reason: until the night
 * named the step that decided its state, its stop reason was its first
 * problem in step order - the checks' routine failures, which come before
 * the upload they hold. */
function heldDetail(run: JobRun, now: Date): string {
  const when = shortWarsawTime(run.finishedAt ?? run.heartbeatAt, now);
  const reason =
    run.errors.find((line) => HELD_STEP.test(line)) ?? run.stopReason;
  return `Wstrzymane kroki: ${when}${reason ? ` (${reason})` : ""}.`;
}

function capturesHealth(
  runs: JobRun[],
  definition: JobDefinition,
  now: Date,
): JobHealth {
  // Stuck for longer than the window is a fact about last week, as the
  // server's open-capture queries have it: listed, but not keeping the row
  // red until twenty newer captures push it off the list.
  const windowStart = now.getTime() - CAPTURE_WINDOW_DAYS * DAY;
  const recent = runs.filter((run) => Date.parse(run.startedAt) >= windowStart);
  const stalled = recent.filter((run) => isStalled(run, definition, now));
  if (stalled.length) {
    return {
      status: "stalled",
      detail: `${pl.format(stalled.length)} ${counted(
        stalled.length,
        "strona utknęła - nic jej już nie podejmie.",
        "strony utknęły - nic ich już nie podejmie.",
        "stron utknęło - nic ich już nie podejmie.",
      )}`,
    };
  }
  const going = recent.filter((run) => !isFinished(run.state));
  if (going.length) {
    return {
      status: "running",
      detail: `${pl.format(going.length)} w toku.`,
    };
  }
  if (!runs.length) {
    return { status: "never", detail: "Nikt jeszcze niczego nie zapisał." };
  }
  return {
    status: "ok",
    detail: `Ostatni zapis: ${shortWarsawTime(runs[0]!.startedAt, now)}.`,
  };
}

/** How a job is doing, from its definition, its newest runs (newest first),
 * its record and whatever its probe found. */
export function jobHealth(
  definition: JobDefinition,
  view: Pick<JobView, "runs" | "record" | "probe" | "unavailable">,
  now: Date,
): JobHealth {
  const runs = view.runs;
  if (view.unavailable && !runs.length && !view.probe) {
    return {
      status: "unknown",
      detail: "Nie udało się wczytać uruchomień - powód jest nad listą.",
    };
  }
  // Captures are a stream of pages, any of which can be stuck behind newer
  // ones that went through. Every other job - a triggered import as much as
  // a scheduled scrape - is as good as its newest run; with no schedule, as
  // a triggered job never has, there is no start to miss.
  if (definition.captures) {
    return capturesHealth(runs, definition, now);
  }

  const probe = view.probe ? probeHealth(view.probe, definition, now) : null;
  const latest = runs[0];
  if (!latest) {
    return (
      probe ?? { status: "never", detail: "Ten job jeszcze nic nie zgłosił." }
    );
  }

  let health: JobHealth;
  if (!isFinished(latest.state)) {
    health = isStalled(latest, definition, now)
      ? {
          status: "stalled",
          detail: `Brak sygnału od ${formatDuration(now.getTime() - Date.parse(latest.heartbeatAt))} (ostatni o ${shortWarsawTime(latest.heartbeatAt, now)}).`,
        }
      : {
          status: "running",
          detail: `Trwa od ${shortWarsawTime(latest.startedAt, now)}${latest.phase ? ` - ${latest.phase}` : ""}.`,
        };
  } else if (latest.state === "failed") {
    health = { status: "failed", detail: stateDetail(latest, now) };
  } else if (latest.state === "partial" && definition.partialIsHeld) {
    health = { status: "held", detail: heldDetail(latest, now) };
  } else if (definition.kind === "ongoing") {
    health = {
      status: "stopped",
      detail: `Zatrzymany ${shortWarsawTime(latest.finishedAt ?? latest.heartbeatAt, now)}${latest.stopReason ? ` (${latest.stopReason})` : ""}.`,
    };
  } else {
    health = {
      status: latest.state === "partial" ? "partial" : "ok",
      detail: stateDetail(latest, now),
    };
  }

  // A schedule only counts once the job has run on it at least once; until
  // then it is a plan, and every night of the plan would read as missed.
  if (
    definition.schedule &&
    scheduleIsLive(definition, view.record) &&
    health.status !== "running" &&
    health.status !== "stalled"
  ) {
    const missed = missedSlot(
      definition.schedule,
      definition.graceMinutes,
      latest.startedAt,
      now,
    );
    if (missed) {
      health = worse(health, {
        status: "late",
        detail: `Nie wystartował o ${shortWarsawTime(missed.toISOString(), now)}.`,
      });
    }
  }
  return probe ? worse(health, probe) : health;
}

/** Whether a job's schedule is something it actually runs on, rather than a
 * plan. A job that reports shows it by having run on it once; until then
 * every night of the plan would read as missed. A probe job never reports,
 * and is watched because it is already running - the export has been firing
 * at 04:00 for months - so its schedule counts from the start. */
export function scheduleIsLive(
  definition: Pick<JobDefinition, "schedule" | "probe">,
  record: JobRecord | null | undefined,
): boolean {
  if (!definition.schedule) return false;
  return Boolean(definition.probe) || Boolean(record?.lastScheduledAt);
}

/** Link to a task on the owner's list. */
export const taskLink = (id: string) => `/admin/zadania#t-${id}`;
