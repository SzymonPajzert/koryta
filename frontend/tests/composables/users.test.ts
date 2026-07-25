import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useUserLookup } from "../../app/composables/users";

const { mockAuthRequest } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
}));

vi.mock("../../app/composables/auth", () => ({
  authRequest: mockAuthRequest,
}));

describe("useUserLookup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockAuthRequest.mockResolvedValue({ users: {} });
  });

  afterEach(async () => {
    // Drain any scheduled flush so state doesn't leak between tests.
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("batches resolve calls into a single request", async () => {
    mockAuthRequest.mockResolvedValue({
      users: {
        "batch-u1": {
          displayName: "Jan",
          email: "jan@example.com",
          photoURL: null,
        },
      },
    });

    const lookup = useUserLookup();
    lookup.resolve(["batch-u1"]);
    lookup.resolve(["batch-u2", "batch-u1"]);

    await vi.runAllTimersAsync();

    expect(mockAuthRequest).toHaveBeenCalledTimes(1);
    const url = mockAuthRequest.mock.calls[0]?.[0] as string;
    expect(url).toContain("/api/users/lookup");
    expect(decodeURIComponent(url)).toContain("batch-u1,batch-u2");

    expect(lookup.displayName("batch-u1")).toBe("Jan");
    // Unresolvable uids fall back to the raw uid.
    expect(lookup.displayName("batch-u2")).toBe("batch-u2");
  });

  it("does not re-request cached uids", async () => {
    mockAuthRequest.mockResolvedValue({
      users: {
        "cache-u1": { displayName: "Anna", email: null, photoURL: null },
      },
    });

    const lookup = useUserLookup();
    lookup.resolve(["cache-u1"]);
    await vi.runAllTimersAsync();

    lookup.resolve(["cache-u1"]);
    await vi.runAllTimersAsync();

    expect(mockAuthRequest).toHaveBeenCalledTimes(1);
  });

  it("falls back to email when there is no display name", async () => {
    mockAuthRequest.mockResolvedValue({
      users: {
        "email-u1": {
          displayName: null,
          email: "ktos@example.com",
          photoURL: null,
        },
      },
    });

    const lookup = useUserLookup();
    lookup.resolve(["email-u1"]);
    await vi.runAllTimersAsync();

    expect(lookup.displayName("email-u1")).toBe("ktos@example.com");
  });

  it("caches failures as null and shows the raw uid", async () => {
    mockAuthRequest.mockRejectedValue(new Error("403"));

    const lookup = useUserLookup();
    lookup.resolve(["fail-u1"]);
    await vi.runAllTimersAsync();

    expect(lookup.displayName("fail-u1")).toBe("fail-u1");
    expect(lookup.cache.value["fail-u1"]).toBeNull();

    // A later resolve should not retry the failed uid.
    lookup.resolve(["fail-u1"]);
    await vi.runAllTimersAsync();
    expect(mockAuthRequest).toHaveBeenCalledTimes(1);
  });

  it("handles missing uids gracefully", () => {
    const lookup = useUserLookup();
    expect(lookup.displayName(null)).toBe("Nieznany");
    expect(lookup.displayName(undefined)).toBe("Nieznany");
  });
});
