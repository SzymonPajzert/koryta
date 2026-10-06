import { onBeforeUnmount, onMounted, ref } from "vue";
import { authRequest } from "~/composables/auth";
import { otherDefinition } from "~/utils/jobStyle";
import {
  JOBS,
  type JobDefinition,
  type JobView,
  type JobsOverview,
} from "~~/shared/jobs";

/** How long a refresh may take before it counts as failed. The answer comes
 * in well under three seconds; one that has not come in thirty is not coming,
 * and while it is out every later poll and click joins it instead of asking
 * again - the page would stop refreshing for as long as it hung. */
export const REFRESH_TIMEOUT_MS = 30_000;

/** Whether the request was given up on after `REFRESH_TIMEOUT_MS`: ofetch
 * aborts it with a `TimeoutError` and fails with that as the cause. */
function timedOut(error: unknown): boolean {
  const failure = error as { name?: string; cause?: { name?: string } } | null;
  return (
    failure?.name === "TimeoutError" || failure?.cause?.name === "TimeoutError"
  );
}

/** What the server said went wrong, in its own words where it gave some. */
function reason(error: unknown): string {
  const data = (error as { data?: { message?: string } } | null)?.data;
  if (data?.message) return data.message;
  if (timedOut(error)) {
    return `serwer nie odpowiedział w ${REFRESH_TIMEOUT_MS / 1000} s`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Every job's recent runs for /admin/procesy, from GET /api/ops/jobs.
 *
 * A refresh that fails keeps the overview it had: a page left open overnight
 * should still show what it last knew, with the error and "Odświeżono" saying
 * how old that is, rather than going blank at the first dropped request. */
export function useOpsJobs() {
  const overview = ref<JobsOverview | null>(null);
  const loading = ref(false);
  const error = ref("");
  const lastLoadedAt = ref<Date | null>(null);

  // A poll that lands while a click's request is still out joins it instead
  // of sending a second one.
  let inFlight: Promise<void> | null = null;

  function load(): Promise<void> {
    if (inFlight) return inFlight;
    loading.value = true;
    inFlight = (async () => {
      try {
        overview.value = await authRequest<JobsOverview>("/api/ops/jobs", {
          method: "GET",
          timeout: REFRESH_TIMEOUT_MS,
        });
        lastLoadedAt.value = new Date();
        error.value = "";
      } catch (failure) {
        error.value = overview.value
          ? `Nie udało się odświeżyć procesów: ${reason(failure)}`
          : `Nie udało się wczytać procesów: ${reason(failure)}`;
      } finally {
        loading.value = false;
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return { overview, loading, error, load, lastLoadedAt };
}

export type OpsJobs = ReturnType<typeof useOpsJobs>;

/** One job as the page lays it out: its definition - the registry's, or one
 * made up for a job only its runs know about - and what the server sent. */
export interface JobEntry {
  definition: JobDefinition;
  view: JobView;
  /** Reported under an id `JOBS` does not list. */
  other: boolean;
}

/** The overview's jobs in `JOBS` order, then the unknown ones. A registered
 * job the server left out still gets a row with no runs, so the list of what
 * should exist never depends on what came back. */
export function jobEntries(overview: JobsOverview): JobEntry[] {
  const views = new Map(overview.jobs.map((view) => [view.id, view]));
  return [
    ...JOBS.map((definition) => ({
      definition,
      view: views.get(definition.id) ?? {
        id: definition.id,
        runs: [],
        record: null,
      },
      other: false,
    })),
    ...overview.others.map((view) => ({
      definition: otherDefinition(view),
      view,
      other: true,
    })),
  ];
}

/** The time, a ref that moves on every `everyMs` while the page is open, so
 * that "W toku" turns into "Bez sygnału" on a page nobody touches - health is
 * a function of the clock as much as of the data. */
export function useTickingNow(everyMs: number) {
  const now = ref(new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = () => (now.value = new Date());
  onMounted(() => {
    tick();
    timer = setInterval(tick, everyMs);
  });
  onBeforeUnmount(() => clearInterval(timer));
  return { now, tick };
}

/** Calls `refresh` every `everyMs` while the tab is in front, and at once
 * when it comes back to it. A hidden tab polls nothing: the answer is only
 * worth its reads while someone can see it, and the server's bucket probes
 * cost a listing each. */
export function usePollWhileVisible(refresh: () => unknown, everyMs: number) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const visible = () => document.visibilityState === "visible";

  const start = () => {
    clearInterval(timer);
    timer = setInterval(() => {
      if (visible()) void refresh();
    }, everyMs);
  };

  const onVisibility = () => {
    if (visible()) {
      void refresh();
      start();
    } else {
      clearInterval(timer);
      timer = undefined;
    }
  };

  onMounted(() => {
    document.addEventListener("visibilitychange", onVisibility);
    if (visible()) start();
  });
  onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    clearInterval(timer);
  });
}
