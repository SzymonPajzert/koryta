import { describe, it, expect } from "vitest";
import {
  auditActions,
  auditActionLabels,
  isVisibilityAction,
} from "../../shared/audit";

describe("shared/audit", () => {
  it("names every action in the panel's language", () => {
    // `Record<AuditAction, string>` already makes a missing label a type error,
    // and that check is not the one this catches: `shared/audit.ts` is
    // symlinked into the triggers, whose build is a separate `tsc` that is only
    // run on deploy, and an action added to the array in a hurry is exactly the
    // kind of half-change that reaches the panel as a bare English key next to
    // six Polish sentences.
    expect(Object.keys(auditActionLabels).sort()).toEqual(
      [...auditActions].sort(),
    );
    for (const action of auditActions) {
      expect(auditActionLabels[action].length).toBeGreaterThan(0);
    }
  });

  it("counts only a whole page going up or down as a visibility decision", () => {
    // The badge verdict decides what a reader sees too, and is deliberately not
    // one of these: hiding one chip is not the same conflict as hiding the
    // page, and a list that merged them would read as two admins fighting over
    // a page when they were ruling on different things.
    const visibility = auditActions.filter(isVisibilityAction);
    expect(visibility).toEqual(["publish", "unpublish"]);
  });
});
