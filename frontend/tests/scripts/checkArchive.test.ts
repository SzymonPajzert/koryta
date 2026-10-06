import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  ARCHIVE,
  archivedScripts,
  judge,
} from "../../scripts/migrate/check-archive";
import { formatRemaining } from "../../scripts/migrate/remaining";

describe("judge", () => {
  const finished = formatRemaining({ rekeyed: 0, restored: 0 });

  it("passes a clean exit that reports zero everywhere", () => {
    expect(judge({ code: 0, signal: null, stdout: finished })).toEqual({
      status: "done",
      counts: { rekeyed: 0, restored: 0 },
    });
  });

  it("flags any count above zero", () => {
    const stdout = formatRemaining({ rekeyed: 0, restored: 3 });
    expect(judge({ code: 0, signal: null, stdout })).toEqual({
      status: "remaining",
      counts: { rekeyed: 0, restored: 3 },
    });
  });

  it("fails a script that crashed, whatever it printed first", () => {
    expect(judge({ code: 1, signal: null, stdout: finished })).toEqual({
      status: "failed",
      reason: "exited with code 1",
    });
    expect(judge({ code: null, signal: "SIGTERM", stdout: "" })).toEqual({
      status: "failed",
      reason: "killed by SIGTERM",
    });
  });

  it("fails a script that did not say what is left", () => {
    expect(judge({ code: 0, signal: null, stdout: "Done.\n" })).toMatchObject({
      status: "failed",
    });
  });
});

describe("the archive", () => {
  const scripts = archivedScripts();

  it("is where the finished migrations are", () => {
    expect(scripts).toContain("repair-migrated-revisions.ts");
  });

  // What check:archived-migrations needs from each of them, checked here so a
  // script moved in without it fails before anybody starts an emulator.
  it.each(scripts)("%s reports what it would still change", (name) => {
    const source = readFileSync(join(ARCHIVE, name), "utf8");
    expect(source).toContain("reportRemaining(");
  });

  it.each(scripts)("%s writes only when given --commit", (name) => {
    const source = readFileSync(join(ARCHIVE, name), "utf8");
    expect(source).toContain('process.argv.includes("--commit")');
  });
});
