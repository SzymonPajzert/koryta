import { describe, it, expect } from "vitest";
import {
  QA_ITEMS,
  qaCheckId,
  qaFeedbackKind,
  qaFeedbackMessage,
  qaItemState,
  qaReportedByOthers,
  qaStateCounts,
  qaVerdictIsReportable,
  type QaCheck,
} from "../../shared/qa";
import { FEEDBACK_ID_PATTERN } from "../../shared/feedbackFixes";

const check = (
  itemId: string,
  status: QaCheck["status"],
  userUid = "u1",
): QaCheck => ({ itemId, userUid, status });

describe("QA_ITEMS", () => {
  it("has unique ids", () => {
    const ids = QA_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses ids that split back out of a check document id", () => {
    for (const item of QA_ITEMS) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(qaCheckId(item.id, "uid123").split("_")).toEqual([
        item.id,
        "uid123",
      ]);
    }
  });

  // Nothing here can check that the newest entry is on top: the order of the
  // array is the only record of it, so there is no second source to compare
  // against. It is a review question, not a test.
  it("says how to check every entry", () => {
    for (const item of QA_ITEMS) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.steps.length).toBeGreaterThan(0);
    }
  });

  // fixIndex skips a malformed id rather than failing, so a typo here would
  // silently attach the fix to no report at all.
  it("names the reports it fixes by well-formed ids, each once", () => {
    for (const item of QA_ITEMS) {
      const fixes = item.fixes ?? [];
      for (const id of fixes) {
        expect(id, `${item.id} fixes ${id}`).toMatch(FEEDBACK_ID_PATTERN);
      }
      expect(new Set(fixes).size, `${item.id} repeats a report`).toBe(
        fixes.length,
      );
    }
  });
});

describe("qaItemState", () => {
  it("is unchecked when this reader has not looked", () => {
    expect(qaItemState("a", [], "u1")).toBe("unchecked");
    expect(qaItemState("a", [check("b", "ok")], "u1")).toBe("unchecked");
  });

  it("is whatever this reader concluded", () => {
    expect(qaItemState("a", [check("a", "ok")], "u1")).toBe("ok");
    expect(qaItemState("a", [check("a", "issue")], "u1")).toBe("issue");
  });

  it("stays unchecked for everybody else once one person checks it", () => {
    const checks = [check("a", "ok", "u1"), check("a", "issue", "u2")];
    expect(qaItemState("a", checks, "u1")).toBe("ok");
    expect(qaItemState("a", checks, "u2")).toBe("issue");
    // The page is worth having because of the second pair of eyes, so
    // somebody else's verdict must not retire the entry.
    expect(qaItemState("a", checks, "u3")).toBe("unchecked");
  });

  it("claims nothing when there is no reader", () => {
    expect(qaItemState("a", [check("a", "ok")], undefined)).toBe("unchecked");
  });
});

describe("qaReportedByOthers", () => {
  it("is true only for a problem somebody else reported", () => {
    const checks = [check("a", "issue", "u2"), check("b", "ok", "u2")];
    expect(qaReportedByOthers("a", checks, "u1")).toBe(true);
    // My own report is already on my card; it is not news.
    expect(qaReportedByOthers("a", checks, "u2")).toBe(false);
    expect(qaReportedByOthers("b", checks, "u1")).toBe(false);
  });
});

describe("qaStateCounts", () => {
  it("counts what this reader has left, not what anybody has", () => {
    const items = [
      { ...QA_ITEMS[0]!, id: "a" },
      { ...QA_ITEMS[0]!, id: "b" },
    ];
    const checks = [check("a", "ok", "u2"), check("b", "issue", "u2")];
    expect(qaStateCounts(items, checks, "u1")).toEqual({
      unchecked: 2,
      ok: 0,
      issue: 0,
    });
  });

  it("counts every item exactly once", () => {
    const items = [
      { ...QA_ITEMS[0]!, id: "a" },
      { ...QA_ITEMS[0]!, id: "b" },
      { ...QA_ITEMS[0]!, id: "c" },
    ];
    const counts = qaStateCounts(
      items,
      [check("a", "ok"), check("b", "issue")],
      "u1",
    );
    expect(counts).toEqual({ unchecked: 1, ok: 1, issue: 1 });
  });
});

describe("qaVerdictIsReportable", () => {
  const withNote = (status: QaCheck["status"], feedback: string): QaCheck => ({
    itemId: "a",
    userUid: "u1",
    status,
    feedback,
  });

  it("reports a problem, with or without words for it", () => {
    expect(qaVerdictIsReportable("issue", "mapa się nie rysuje", null)).toBe(
      true,
    );
    expect(qaVerdictIsReportable("issue", "", null)).toBe(true);
  });

  it("reports an approval that came with something to say", () => {
    expect(qaVerdictIsReportable("ok", "działa, ale wolno", null)).toBe(true);
  });

  it("keeps a bare tick out of the channel", () => {
    expect(qaVerdictIsReportable("ok", "", null)).toBe(false);
    expect(qaVerdictIsReportable("ok", "   ", null)).toBe(false);
  });

  it("does not repeat a verdict that has not changed", () => {
    const previous = withNote("issue", "mapa się nie rysuje");
    expect(
      qaVerdictIsReportable("issue", "mapa się nie rysuje", previous),
    ).toBe(false);
    // Whitespace alone is not a new report either.
    expect(
      qaVerdictIsReportable("issue", "  mapa się nie rysuje  ", previous),
    ).toBe(false);
  });

  it("reports a changed mind, and reworded findings", () => {
    const previous = withNote("issue", "mapa się nie rysuje");
    expect(qaVerdictIsReportable("ok", "już działa", previous)).toBe(true);
    expect(qaVerdictIsReportable("issue", "i legenda też", previous)).toBe(
      true,
    );
    // Taking the words back but keeping the verdict still says something.
    expect(qaVerdictIsReportable("issue", "", previous)).toBe(true);
  });
});

describe("qaFeedbackMessage", () => {
  it("is what the checker wrote", () => {
    expect(qaFeedbackMessage("  mapa się nie rysuje  ")).toBe(
      "mapa się nie rysuje",
    );
  });

  it("stands in for a problem reported without words", () => {
    // The API rejects an empty body, and losing the report would be worse than
    // forwarding a bare "something is wrong here".
    expect(qaFeedbackMessage("")).toBe("Zgłoszono problem bez opisu.");
  });
});

describe("qaFeedbackKind", () => {
  it("files a problem as a bug and a comment as an idea", () => {
    expect(qaFeedbackKind("issue")).toBe("bug");
    expect(qaFeedbackKind("ok")).toBe("idea");
  });
});
