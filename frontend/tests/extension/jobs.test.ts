import { describe, it, expect } from "vitest";
// @ts-expect-error - the extension is plain JS with no types of its own.
import {
  jobIsBusy,
  jobMessage,
  jobProgressUrl,
} from "../../../extension/jobs.js";
import { runLink } from "../../shared/jobs";

/** Every state the background worker can set, because the table is the whole
 * point: a state missing from it renders as a blank line over a job that is
 * still running, and the popup and the panel would both show it. */
const STATES = [
  "idle",
  "capturing",
  "uploading",
  "extracting",
  "unauthenticated",
  "slow",
  "stored",
  "done",
  "error",
];

describe("jobMessage", () => {
  it("says something for every state but idle", () => {
    for (const state of STATES) {
      const message = jobMessage({
        state,
        message: "wolno",
        error: "coś",
        facts: 3,
      });
      expect(typeof message).toBe("string");
      if (state !== "idle") expect(message).not.toBe("");
    }
  });

  it("says nothing about a state it has never heard of", () => {
    // Rather than throwing: the worker is the only thing that sets these, but a
    // half-updated unpacked extension really can have a popup older than its
    // background page.
    expect(jobMessage({ state: "teleportowanie" })).toBe("");
    expect(jobMessage(undefined)).toBe("");
  });

  it("counts facts in Polish", () => {
    expect(jobMessage({ state: "done", facts: 1 })).toContain("1 fakt ");
    expect(jobMessage({ state: "done", facts: 3 })).toContain("3 fakty ");
    expect(jobMessage({ state: "done", facts: 7 })).toContain("7 faktów ");
  });

  it("does not call an unstarted extraction a failed capture", () => {
    // The page is in the archive and the nightly pipeline reads the bucket
    // regardless, so this is the one error-ish state that must not read as
    // "nie udało się" — that sends someone off to re-capture a page that is
    // already saved.
    const message = jobMessage({
      state: "stored",
      error: "extractor not configured",
    });
    expect(message).toContain("Zapisane w archiwum");
    expect(message).not.toContain("Nie udało się");
    // The underlying reason still travels: it is the only clue that a variable
    // is unset somewhere, and whoever sees it is the person who can set it.
    expect(message).toContain("extractor not configured");
  });

  it("still reports an extraction that ran and broke", () => {
    expect(jobMessage({ state: "error", error: "model timed out" })).toBe(
      "Nie udało się: model timed out",
    );
  });
});

describe("jobIsBusy", () => {
  it("holds the button only while something is running", () => {
    for (const state of ["capturing", "uploading", "extracting"]) {
      expect(jobIsBusy({ state })).toBe(true);
    }
    // `stored` and `slow` are both finished as far as this tab is concerned —
    // nothing further is coming, so the button goes back.
    for (const state of ["idle", "done", "error", "stored", "slow"]) {
      expect(jobIsBusy({ state })).toBe(false);
    }
    expect(jobIsBusy(undefined)).toBe(false);
  });
});

describe("jobProgressUrl", () => {
  it("links a capture to its run on /admin/procesy once the page has an id", () => {
    expect(
      jobProgressUrl("https://koryta.pl", {
        state: "extracting",
        pageId: "abc",
      }),
    ).toBe("https://koryta.pl/admin/procesy#przebieg-abc");
    // The same anchor the page builds (`runLink` in shared/jobs.ts).
    expect(
      jobProgressUrl("http://localhost:3000", { state: "done", pageId: "a/b" }),
    ).toBe(`http://localhost:3000${runLink("a%2Fb")}`);
  });

  it("has nothing to link before the upload names the page", () => {
    for (const state of ["capturing", "uploading", "unauthenticated"]) {
      expect(jobProgressUrl("https://koryta.pl", { state })).toBeNull();
    }
    expect(jobProgressUrl("https://koryta.pl", undefined)).toBeNull();
  });
});
