import { describe, it, expect } from "vitest";
import { FEEDBACK_ID_PATTERN } from "../../shared/feedbackFixes";
import { REPORT_FIXES } from "../../shared/reportFixes";

describe("REPORT_FIXES", () => {
  it("names the reports it fixes by well-formed ids, each once", () => {
    // An id that is not a Firestore auto-id matches no report, so the claim
    // would never show anywhere - on /qa or on /admin/opinie.
    for (const fix of REPORT_FIXES) {
      expect(fix.fixes.length, fix.change).toBeGreaterThan(0);
      for (const id of fix.fixes) {
        expect(id, `${fix.change} fixes ${id}`).toMatch(FEEDBACK_ID_PATTERN);
      }
      expect(new Set(fix.fixes).size, `${fix.change} repeats a report`).toBe(
        fix.fixes.length,
      );
    }
  });

  it("says what changed", () => {
    // It is the only description of the change the admin checking it gets.
    for (const fix of REPORT_FIXES) {
      expect(fix.change.trim(), fix.fixes.join(", ")).not.toBe("");
    }
  });

  it("links only to pages of the site", () => {
    for (const fix of REPORT_FIXES) {
      if (fix.link === undefined) continue;
      expect(fix.link, fix.change).toMatch(/^\/(?!\/)/);
    }
  });
});
