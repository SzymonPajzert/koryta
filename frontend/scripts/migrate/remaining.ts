/**
 * The line a migration's dry run ends with: how much it would still change,
 * as JSON, so `check-archive.ts` can read every script's answer without
 * knowing how each one words its own report.
 *
 * Count only what the run would write. Documents a script reports and leaves
 * alone on purpose are not left to migrate - a finished migration still has
 * them - and counting them would keep it from ever reading zero.
 */

const PREFIX = "Remaining to migrate: ";

export type Remaining = Record<string, number>;

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

export function formatRemaining(counts: Remaining): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    throw new Error("A dry run has to report at least one count");
  }
  for (const [name, count] of entries) {
    if (!isCount(count)) {
      throw new Error(`"${name}" is ${count}, which is not a count`);
    }
  }
  return PREFIX + JSON.stringify(counts);
}

/** Print it. Once, on the dry run: after `--commit` the same numbers are what
 * was written, not what is left. */
export function reportRemaining(counts: Remaining): void {
  console.log(formatRemaining(counts));
}

/** The counts a dry run reported, or why there are none to read. Anything
 * short of exactly one well-formed line is an error rather than a zero: a
 * script that stopped reporting has not finished anything. */
export function readRemaining(
  output: string,
): { counts: Remaining } | { error: string } {
  const lines = output
    .split("\n")
    .filter((line) => line.startsWith(PREFIX))
    .map((line) => line.slice(PREFIX.length));
  if (lines.length === 0) {
    return { error: `printed no "${PREFIX.trim()}" line` };
  }
  if (lines.length > 1) {
    return { error: `reported ${lines.length} times` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0]!);
  } catch {
    return { error: `reported ${lines[0]}, which is not JSON` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: `reported ${lines[0]}, which is not a set of counts` };
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0 || !entries.every(([, count]) => isCount(count))) {
    return { error: `reported ${lines[0]}, which is not a set of counts` };
  }
  return { counts: Object.fromEntries(entries) as Remaining };
}
