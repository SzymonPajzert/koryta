import { describe, it, expect } from "vitest";
// @ts-expect-error - the extension is plain JS with no types of its own.
import { normalizeOrigin, DEFAULT_ORIGIN } from "../../../extension/config.js";

describe("normalizeOrigin", () => {
  it("adds the scheme somebody left out", () => {
    // The case this exists for. Stored as typed, `localhost:3000` reaches
    // `fetch` as a url whose *protocol* is `localhost:` — which throws
    // "Failed to fetch" and names nothing, so the popup looks correctly
    // configured while every capture fails.
    expect(normalizeOrigin("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeOrigin("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  it("keeps a scheme that is already there", () => {
    expect(normalizeOrigin("https://koryta.pl")).toBe("https://koryta.pl");
    expect(normalizeOrigin(DEFAULT_ORIGIN)).toBe(DEFAULT_ORIGIN);
    expect(normalizeOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("drops trailing slashes, paths and whitespace", () => {
    // `${origin}${path}` builds every request, so anything after the host would
    // be spliced into the middle of the url.
    expect(normalizeOrigin("  http://localhost:3000/  ")).toBe(
      "http://localhost:3000",
    );
    expect(normalizeOrigin("http://localhost:3000///")).toBe(
      "http://localhost:3000",
    );
    expect(normalizeOrigin("https://koryta.pl/zrodla")).toBe(
      "https://koryta.pl",
    );
  });

  it("refuses what it cannot repair, rather than defaulting to production", () => {
    // Falling back to koryta.pl here would send a capture meant for a dev
    // server to the live site.
    for (const bad of ["", "   ", "http://", "://nope"]) {
      expect(() => normalizeOrigin(bad)).toThrow();
    }
  });
});
