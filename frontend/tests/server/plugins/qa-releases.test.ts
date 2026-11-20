import { beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../../../server/plugins/qa-releases";

const { mockRecord } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineNitroPlugin = (fn: any) => fn;
  return { mockRecord: vi.fn() };
});

vi.mock("~~/server/utils/qaReleases", () => ({
  qaReleaseRecord: mockRecord,
}));

const start = () => (plugin as unknown as () => void)();

describe("qa-releases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records this build's entries as the server starts", () => {
    mockRecord.mockResolvedValue({});

    start();

    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("logs a failure rather than taking the server down with it", async () => {
    const failure = new Error("UNAVAILABLE");
    mockRecord.mockRejectedValue(failure);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(start).not.toThrow();
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.any(String), failure),
    );
    error.mockRestore();
  });
});
