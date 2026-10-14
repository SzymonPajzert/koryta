// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/** Where `latest` may be read, and how.
 *
 * The flag is a request, and only a verified token makes it a permission -
 * `wantsLatest` in server/utils/handlers.ts holds both halves. Every route that
 * read the flag for itself handed drafts to whoever typed it: /api/graph/local
 * and /api/nodes/[id] on main until 2026-10-14, and the same mistake was made
 * again on the succession-explorer and umowy-ui branches before anybody had
 * merged a fix. So the rule is checked over the source rather than left to a
 * test per route.
 */
const SERVER = fileURLToPath(new URL("../../server", import.meta.url));
const GATE = "utils/handlers.ts";

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (path.endsWith(".ts")) yield path;
  }
}

const sources = [...sourceFiles(SERVER)].map((path) => ({
  path: relative(SERVER, path),
  text: readFileSync(path, "utf8"),
}));

describe("the `latest` flag", () => {
  it("is read off a request by the gate alone", () => {
    const readers = sources
      .filter(({ path }) => path !== GATE)
      .filter(({ text }) => /\.latest\b|\[\s*["']latest["']\s*\]/.test(text))
      .map(({ path }) => path);
    expect(readers).toEqual([]);
  });

  it("is always awaited, so a pending answer is never taken for a yes", () => {
    const unawaited = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/\b(wantsLatest|bodyWantsLatest|resolveReader)\(/g)]
        .filter((match) => {
          const before = text.slice(Math.max(0, match.index - 16), match.index);
          return !/(await |function )$/.test(before);
        })
        .map((match) => `${path}: ${match[0]}`),
    );
    expect(unawaited).toEqual([]);
  });
});
