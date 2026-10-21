import { describe, it, expect, vi, afterEach } from "vitest";
import chunkReload from "../../app/plugins/chunk-reload.client";

const GUARD = "chunk-reload:attempted";

const install = () => (chunkReload as unknown as () => void)();

describe("chunk-reload plugin", () => {
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.removeItem(GUARD);
  });

  it("clears the reload guard once the page has stayed up ten seconds", () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    sessionStorage.setItem(GUARD, "1");
    install();

    vi.advanceTimersByTime(9_999);
    expect(sessionStorage.getItem(GUARD)).toBe("1");
    vi.advanceTimersByTime(1);
    expect(sessionStorage.getItem(GUARD)).toBeNull();
  });

  /** What a test file's teardown does to the timer above. Vitest's nuxt
   * environment deletes `sessionStorage` from the global scope when the file
   * ends, but the timer is Node's own and fires all the same, so a file that
   * ended within ten seconds of booting the app failed the whole run with
   * "ReferenceError: sessionStorage is not defined". */
  it("lets the clear go when sessionStorage has gone from under it", () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    install();

    const storage = Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage",
    )!;
    Reflect.deleteProperty(globalThis, "sessionStorage");
    try {
      expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "sessionStorage", storage);
    }
  });
});
