/** Starting the machine that does the runs asked for on the site's pages.
 *
 * The runs need Python, the pipelines' outputs and the PESEL-keyed people, none
 * of which the site has; they are all on the koryta-nightly VM, which spends
 * most of the day switched off. So a request is a queued run in the ops
 * database (`jobRequests.ts`) and this starts the VM for it: its
 * koryta-requests.service takes the queue at boot and switches the VM off when
 * it is done (data/nightly/requests.sh).
 *
 * `JOB_RUNNER_DISPATCH`:
 * - `vm` - start the instance through the Compute API, as this backend's own
 *   service account, which needs `compute.instances.start` on that one
 *   instance. Starting a running VM does nothing, which is what a second
 *   click while it is up should do.
 * - `off` (the default, and locally) - start nothing: the run waits for the
 *   next night, whose boot runs the worker too. A local stack runs the worker
 *   by hand, against the emulator (`koryta_job_requests --once`).
 */
import type { RunDispatch } from "~~/shared/jobs";
import { metadataAccessToken } from "~~/server/utils/metadataToken";

export type RunnerConfig = {
  mode: "vm" | "off";
  project: string;
  zone: string;
  instance: string;
};

/** From the runtime config, or from the one a test hands in. */
export function runnerConfig(
  config: Record<string, unknown> = useRuntimeConfig(),
): RunnerConfig {
  return {
    mode: String(config.jobRunnerDispatch || "off") === "vm" ? "vm" : "off",
    project: String(config.gcpProject || ""),
    zone: String(config.jobRunnerZone || ""),
    instance: String(config.jobRunnerInstance || ""),
  };
}

/** What Google answered, in a line: its own message where it gave one. */
function describe(error: unknown): string {
  const data = (error as { data?: { error?: { message?: string } } } | null)
    ?.data;
  if (data?.error?.message) return data.error.message;
  return error instanceof Error ? error.message : String(error);
}

/** The one HTTP call this makes, so a test can stand in for it: a bare
 * `$fetch` here is a module binding a test cannot stub. */
type Post = (
  url: string,
  options: { method: "POST"; headers: Record<string, string> },
) => Promise<unknown>;

/** Start the VM for a queued run. Never throws: a run whose machine could not
 * be started is still queued, and the night runs it - the caller records
 * what happened on the run, where /admin/procesy shows it. */
export async function startRunner(
  now: Date = new Date(),
  config: RunnerConfig = runnerConfig(),
  // Called through `Post`: given a bare `string`, nitro's typed `$fetch`
  // matches the url against every route the app serves, a comparison that
  // sits at TypeScript's depth limit - an unrelated query field elsewhere
  // tipped it into TS2321 (2026-10-27). The url is Compute Engine's, never one
  // of ours, so the route types have nothing to say about it anyway.
  post: Post = (url, options) => ($fetch as unknown as Post)(url, options),
): Promise<RunDispatch> {
  const at = now.toISOString();
  if (config.mode === "off") {
    return { mode: "off", at, ok: false, error: null };
  }
  if (!config.project || !config.zone || !config.instance) {
    return {
      mode: "vm",
      at,
      ok: false,
      error: "brak JOB_RUNNER_ZONE albo JOB_RUNNER_INSTANCE",
    };
  }
  try {
    const token = await metadataAccessToken();
    const instance = `projects/${config.project}/zones/${config.zone}/instances/${config.instance}`;
    await post(`https://compute.googleapis.com/compute/v1/${instance}/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return { mode: "vm", at, ok: true, error: null };
  } catch (error) {
    const message = describe(error);
    console.error("Starting the job runner VM failed", message);
    return { mode: "vm", at, ok: false, error: message.slice(0, 300) };
  }
}
