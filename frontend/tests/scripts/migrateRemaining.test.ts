import { describe, it, expect } from "vitest";
import {
  formatRemaining,
  readRemaining,
} from "../../scripts/migrate/remaining";

describe("formatRemaining", () => {
  it("reads back as the counts it was given", () => {
    const line = formatRemaining({ rekeyed: 1114, restored: 0 });
    expect(readRemaining(`Scanning 9 revisions.\n${line}\n`)).toEqual({
      counts: { rekeyed: 1114, restored: 0 },
    });
  });

  it("refuses something that is not a count", () => {
    expect(() => formatRemaining({ pins: Number.NaN })).toThrow(/pins/);
    expect(() => formatRemaining({ pins: -1 })).toThrow(/pins/);
    expect(() => formatRemaining({ pins: 1.5 })).toThrow(/pins/);
  });

  it("refuses to report nothing at all", () => {
    expect(() => formatRemaining({})).toThrow();
  });
});

describe("readRemaining", () => {
  it("finds the line among the script's own output", () => {
    const output = [
      "Connecting to local emulator Firestore (dry run - pass --commit to apply)",
      "  to pin as the person stated it:   0",
      formatRemaining({ pins: 0, proposals: 0 }),
      "",
      "Dry run. Re-run with --commit to apply.",
    ].join("\n");
    expect(readRemaining(output)).toEqual({
      counts: { pins: 0, proposals: 0 },
    });
  });

  it("says so when the script reported nothing", () => {
    expect(readRemaining("Would rewrite node_id on 0 revision(s).\n")).toEqual({
      error: expect.stringMatching(/no "Remaining to migrate:" line/),
    });
  });

  it("will not pick between two reports", () => {
    const line = formatRemaining({ pins: 0 });
    expect(readRemaining(`${line}\n${line}\n`)).toEqual({
      error: expect.stringMatching(/2 times/),
    });
  });

  it("will not read a malformed report as zero", () => {
    for (const json of [
      "not json",
      "[]",
      "{}",
      '{"pins":"0"}',
      '{"pins":-3}',
      '{"pins":null}',
    ]) {
      expect(readRemaining(`Remaining to migrate: ${json}\n`)).toHaveProperty(
        "error",
      );
    }
  });
});
