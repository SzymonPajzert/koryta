import { describe, it, expect } from "vitest";
import {
  FEEDBACK_ID_PATTERN,
  blocksClosing,
  fixIndex,
  fixState,
  fixTargetsOf,
  followUpsOf,
  suggestClose,
} from "../../shared/feedbackFixes";
import type { Feedback, FeedbackStatus } from "../../shared/model";
import type { QaCheck, QaCheckStatus, QaItem } from "../../shared/qa";

/** A well-formed feedback id: Firestore auto-ids are 20 alphanumerics. */
const fid = (tag: string) => tag.padEnd(20, "0");

const R1 = fid("report1");
const R2 = fid("report2");
const R3 = fid("report3");

function entry(id: string, fixes?: string[]): QaItem {
  return {
    id,
    title: `entry ${id}`,
    description: "d",
    steps: ["s"],
    area: "admin",
    ...(fixes ? { fixes } : {}),
  };
}

const check = (
  itemId: string,
  status: QaCheckStatus,
  userUid = "u1",
): QaCheck => ({ itemId, userUid, status });

function report(
  id: string,
  fields: {
    createdAt?: string;
    adminStatus?: FeedbackStatus;
    qa?: { itemId: string; status: QaCheckStatus };
  } = {},
): Feedback {
  const { createdAt, adminStatus, qa } = fields;
  return {
    id,
    kind: "bug",
    message: `report ${id}`,
    context: {
      route: qa ? "/qa" : "/",
      ...(qa ? { qa: { ...qa, title: `entry ${qa.itemId}` } } : {}),
    },
    createdAt: createdAt ?? "2026-09-01T00:00:00.000Z",
    adminStatus: adminStatus ?? "new",
  };
}

/** A report written on /qa while checking `itemId`. */
const followUp = (
  id: string,
  itemId: string,
  status: QaCheckStatus,
  fields: { createdAt?: string; adminStatus?: FeedbackStatus } = {},
) => report(id, { ...fields, qa: { itemId, status } });

const ids = (reports: readonly Feedback[]) => reports.map((r) => r.id);

describe("FEEDBACK_ID_PATTERN", () => {
  it("accepts a Firestore auto-id", () => {
    expect(FEEDBACK_ID_PATTERN.test("Ab3dEf6hIj9kLm2nOp5q")).toBe(true);
    expect(FEEDBACK_ID_PATTERN.test("01234567890123456789")).toBe(true);
  });

  it("rejects anything that is not exactly 20 alphanumerics", () => {
    for (const bad of [
      "Ab3dEf6hIj9kLm2nOp5", // 19
      "Ab3dEf6hIj9kLm2nOp5qr", // 21
      "Ab3dEf6hIj-kLm2nOp5q",
      "Ab3dEf6hIj/kLm2nOp5q",
      "",
      // The whole fragment pasted from the Slack link instead of the id.
      "fb-Ab3dEf6hIj9kLm2nOp5q",
      " Ab3dEf6hIj9kLm2nOp5q",
    ]) {
      expect(FEEDBACK_ID_PATTERN.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("fixIndex", () => {
  it("lists one entry under every report it fixes", () => {
    const fix = entry("fix", [R1, R2]);
    const index = fixIndex([fix]);
    expect([...index.keys()].sort()).toEqual([R1, R2].sort());
    expect(index.get(R1)).toEqual([fix]);
    expect(index.get(R2)).toEqual([fix]);
  });

  it("lists several entries fixing one report in list order, newest first", () => {
    // Ids chosen so that alphabetical order would be the wrong one.
    const newer = entry("a-fix-of-the-fix", [R1]);
    const older = entry("z-first-fix", [R1, R2]);
    const index = fixIndex([newer, older]);
    expect(index.get(R1)).toEqual([newer, older]);
    expect(index.get(R1)![0]).toBe(newer);
    expect(index.get(R2)).toEqual([older]);
  });

  it("counts an id repeated inside one entry once", () => {
    const fix = entry("fix", [R1, R1]);
    expect(fixIndex([fix]).get(R1)).toEqual([fix]);
  });

  it("skips malformed ids and keeps the good ones next to them", () => {
    const fix = entry("fix", [
      "short",
      `fb-${R1}`,
      `${R2}x`,
      "Ab3dEf6hIj-kLm2nOp5q",
      R3,
    ]);
    const index = fixIndex([fix]);
    expect([...index.keys()]).toEqual([R3]);
  });

  it("ignores entries that fix nothing", () => {
    expect(fixIndex([entry("plain"), entry("empty", [])]).size).toBe(0);
    const fix = entry("fix", [R1]);
    expect(fixIndex([entry("plain"), fix, entry("empty", [])]).get(R1)).toEqual(
      [fix],
    );
  });
});

describe("fixState", () => {
  const fix = entry("fix", [R1]);

  it("is awaiting while nobody has checked the entry", () => {
    expect(fixState(fix, [])).toBe("awaiting");
  });

  it("works when every verdict on it is ok", () => {
    expect(fixState(fix, [check("fix", "ok")])).toBe("works");
    expect(
      fixState(fix, [check("fix", "ok", "u1"), check("fix", "ok", "u2")]),
    ).toBe("works");
  });

  it("is broken on a single issue, however many say it works", () => {
    expect(fixState(fix, [check("fix", "issue")])).toBe("broken");
    const oks = [check("fix", "ok", "u1"), check("fix", "ok", "u3")];
    expect(fixState(fix, [...oks, check("fix", "issue", "u2")])).toBe("broken");
    expect(fixState(fix, [check("fix", "issue", "u2"), ...oks])).toBe("broken");
  });

  it("goes by verdicts on this entry only", () => {
    expect(fixState(fix, [check("other", "ok")])).toBe("awaiting");
    expect(fixState(fix, [check("other", "issue")])).toBe("awaiting");
    expect(fixState(fix, [check("other", "issue"), check("fix", "ok")])).toBe(
      "works",
    );
  });
});

describe("followUpsOf", () => {
  const newer = entry("fix-2", [R1]);
  const older = entry("fix-1", [R1]);
  const original = report(R1);
  const aboutOlder = followUp(fid("aboutOlder"), "fix-1", "issue", {
    createdAt: "2026-09-02T00:00:00.000Z",
  });
  const aboutNewer = followUp(fid("aboutNewer"), "fix-2", "ok", {
    createdAt: "2026-09-05T00:00:00.000Z",
  });
  const aboutOther = followUp(fid("aboutOther"), "unrelated", "issue", {
    createdAt: "2026-09-04T00:00:00.000Z",
  });
  const plain = report(fid("plain"), { createdAt: "2026-09-06T00:00:00.000Z" });

  it("finds the reports written about any claiming entry, newest first", () => {
    // Oldest first in the input, so only the sort can put them right.
    const all = [original, aboutOlder, aboutOther, plain, aboutNewer];
    expect(ids(followUpsOf(original, [newer, older], all))).toEqual([
      aboutNewer.id,
      aboutOlder.id,
    ]);
  });

  it("looks only at the entries it is given", () => {
    const all = [original, aboutOlder, aboutNewer];
    expect(ids(followUpsOf(original, [newer], all))).toEqual([aboutNewer.id]);
    expect(followUpsOf(original, [], all)).toEqual([]);
  });

  it("ignores reports not written on /qa", () => {
    expect(followUpsOf(original, [newer, older], [original, plain])).toEqual(
      [],
    );
  });

  it("does not count the report as its own follow-up", () => {
    // A report written while checking fix-1, looked up with fix-1 among its
    // own entries.
    const self = followUp(fid("self"), "fix-1", "issue");
    const all = [self, aboutOlder];
    expect(ids(followUpsOf(self, [older], all))).toEqual([aboutOlder.id]);
  });

  it("leaves the list it was given alone", () => {
    const all = [aboutOlder, aboutNewer];
    followUpsOf(original, [newer, older], all);
    expect(ids(all)).toEqual([aboutOlder.id, aboutNewer.id]);
  });
});

describe("fixTargetsOf", () => {
  const gone = fid("notLoaded");
  const newer = entry("fix-2", [R1, R2, gone]);
  const older = entry("fix-1", [R1]);
  const index = fixIndex([newer, older, entry("fixes-nothing")]);
  const r1 = report(R1);
  const r2 = report(R2);
  const r3 = report(R3);

  it("points a follow-up at every loaded report its entry claims", () => {
    const check2 = followUp(fid("check2"), "fix-2", "issue");
    const found = fixTargetsOf(check2, index, [r1, r2, r3, check2]);
    expect(ids(found).sort()).toEqual([R1, R2].sort());
  });

  it("goes by the entry the follow-up names, not the others", () => {
    const check1 = followUp(fid("check1"), "fix-1", "ok");
    expect(ids(fixTargetsOf(check1, index, [r1, r2, r3, check1]))).toEqual([
      R1,
    ]);
  });

  it("does not point a follow-up at itself", () => {
    // The fix of the fix names the report complaining about it, too.
    const complaint = followUp(fid("complaint"), "fix-3", "issue");
    const fix3 = entry("fix-3", [R1, complaint.id!]);
    const all = [r1, complaint];
    expect(ids(fixTargetsOf(complaint, fixIndex([fix3]), all))).toEqual([R1]);
  });

  it("finds nothing for a report not written on /qa", () => {
    expect(fixTargetsOf(r1, index, [r1, r2, r3])).toEqual([]);
  });

  it("finds nothing when the report's entry claims to fix nothing", () => {
    const aboutPlain = followUp(fid("aboutPlain"), "fixes-nothing", "issue");
    expect(fixTargetsOf(aboutPlain, index, [r1, r2, aboutPlain])).toEqual([]);
    const aboutUnknown = followUp(fid("aboutUnknown"), "no-such-entry", "ok");
    expect(fixTargetsOf(aboutUnknown, index, [r1, r2, aboutUnknown])).toEqual(
      [],
    );
  });
});

describe("blocksClosing", () => {
  it("blocks while a problem reported against the fix is open", () => {
    for (const adminStatus of ["new", "in_progress"] as const) {
      const problem = followUp(fid("problem"), "fix", "issue", { adminStatus });
      expect(blocksClosing(problem), adminStatus).toBe(true);
    }
  });

  it("does not block once the problem is settled", () => {
    for (const adminStatus of ["resolved", "wont_fix"] as const) {
      const problem = followUp(fid("problem"), "fix", "issue", { adminStatus });
      expect(blocksClosing(problem), adminStatus).toBe(false);
    }
  });

  it("does not block on an ok verdict or a report not written on /qa", () => {
    for (const adminStatus of ["new", "in_progress"] as const) {
      const praise = followUp(fid("praise"), "fix", "ok", { adminStatus });
      expect(blocksClosing(praise), adminStatus).toBe(false);
      expect(blocksClosing(report(R1, { adminStatus })), adminStatus).toBe(
        false,
      );
    }
  });
});

describe("suggestClose", () => {
  const open = report(R1);

  it("suggests closing an open report whose fix works", () => {
    expect(suggestClose(open, "works", [])).toBe(true);
    expect(
      suggestClose(report(R1, { adminStatus: "in_progress" }), "works", []),
    ).toBe(true);
  });

  it("does not suggest closing a report that is already settled", () => {
    for (const adminStatus of ["resolved", "wont_fix"] as const) {
      expect(suggestClose(report(R1, { adminStatus }), "works", [])).toBe(
        false,
      );
    }
  });

  it("waits for somebody to say the fix works", () => {
    expect(suggestClose(open, "awaiting", [])).toBe(false);
    expect(suggestClose(open, "broken", [])).toBe(false);
  });

  it("holds back while a problem reported against the fix is still open", () => {
    for (const adminStatus of ["new", "in_progress"] as const) {
      const problem = followUp(fid("problem"), "fix", "issue", {
        adminStatus,
      });
      expect(suggestClose(open, "works", [problem]), adminStatus).toBe(false);
    }
  });

  it("is not held back by a problem already dealt with or by praise", () => {
    for (const adminStatus of ["resolved", "wont_fix"] as const) {
      const problem = followUp(fid("problem"), "fix", "issue", {
        adminStatus,
      });
      expect(suggestClose(open, "works", [problem]), adminStatus).toBe(true);
    }
    // An open report saying it works is a comment, not a problem.
    const praise = followUp(fid("praise"), "fix", "ok");
    expect(suggestClose(open, "works", [praise])).toBe(true);
  });
});

describe("a fix, a broken fix and a fix of the fix", () => {
  // What /admin/opinie does for each report the QA list claims: the newest
  // entry decides the state, and follow-ups about any of the entries count.
  function suggestion(
    target: Feedback,
    items: QaItem[],
    checks: QaCheck[],
    all: Feedback[],
  ) {
    const entries = fixIndex(items).get(target.id!)!;
    const state = fixState(entries[0]!, checks);
    return suggestClose(target, state, followUpsOf(target, entries, all));
  }

  it("offers closing the original once the complaint about the first fix is closed", () => {
    const original = report(R1);
    const complaint = followUp(fid("complaint"), "fix-1", "issue", {
      createdAt: "2026-09-03T00:00:00.000Z",
    });
    const items = [entry("fix-2", [R1, complaint.id!]), entry("fix-1", [R1])];
    // fix-1 was found broken, fix-2 works.
    const checks = [check("fix-1", "issue", "u2"), check("fix-2", "ok", "u2")];
    const all = [original, complaint];

    // The newest entry decides: the old verdict does not make it broken.
    expect(suggestion(complaint, items, checks, all)).toBe(true);
    // The original waits for the complaint about fix-1 to be closed first.
    expect(suggestion(original, items, checks, all)).toBe(false);
    const closed = { ...complaint, adminStatus: "resolved" as const };
    expect(suggestion(original, items, checks, [original, closed])).toBe(true);
    // And the complaint knows which report it came from.
    expect(ids(fixTargetsOf(complaint, fixIndex(items), all))).toEqual([R1]);
  });
});
