import { describe, it, expect, vi, beforeEach } from "vitest";
import { runnerConfig, startRunner } from "../../../server/utils/jobRunner";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

/** The runtime config the runner is given, per test. */
let config: Record<string, string> = {};

vi.mock("~~/server/utils/metadataToken", () => ({
  metadataAccessToken: async () => "token",
}));

const NOW = new Date("2026-10-06T10:00:00.000Z");

/** What the runtime config would hand the runner, and a stand-in for the
 * Compute API: nothing here may reach Google. */
const start = () => startRunner(NOW, runnerConfig(config), mockFetch);

describe("startRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config = {};
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("starts nothing where it is not configured - the night runs the queue", async () => {
    expect(runnerConfig(config).mode).toBe("off");
    expect(await start()).toEqual({
      mode: "off",
      at: NOW.toISOString(),
      ok: false,
      error: null,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("starts the one instance through the Compute API", async () => {
    Object.assign(config, {
      jobRunnerDispatch: "vm",
      gcpProject: "koryta-pl",
      jobRunnerZone: "europe-central2-b",
      jobRunnerInstance: "koryta-nightly",
    });
    mockFetch.mockResolvedValue({ kind: "compute#operation" });

    expect(await start()).toMatchObject({ mode: "vm", ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://compute.googleapis.com/compute/v1/projects/koryta-pl/zones/europe-central2-b/instances/koryta-nightly/start",
      { method: "POST", headers: { Authorization: "Bearer token" } },
    );
  });

  it("says what Google refused with, and never throws", async () => {
    Object.assign(config, {
      jobRunnerDispatch: "vm",
      gcpProject: "koryta-pl",
      jobRunnerZone: "europe-central2-b",
      jobRunnerInstance: "koryta-nightly",
    });
    mockFetch.mockRejectedValue(
      Object.assign(new Error("403"), {
        data: {
          error: { message: "Required 'compute.instances.start' permission" },
        },
      }),
    );

    expect(await start()).toEqual({
      mode: "vm",
      at: NOW.toISOString(),
      ok: false,
      error: "Required 'compute.instances.start' permission",
    });
  });

  it("names what is missing from the configuration", async () => {
    Object.assign(config, { jobRunnerDispatch: "vm", gcpProject: "koryta-pl" });

    expect((await start()).error).toContain("JOB_RUNNER_ZONE");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
