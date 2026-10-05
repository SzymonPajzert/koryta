import { describe, it, expect, vi } from "vitest";
import handler from "../../../server/api/stats/queueTiers.get";

const { people } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  // The handler is wrapped in nitro's cache; here it runs straight through.
  globals.defineCachedEventHandler = (fn: unknown) => fn;

  return { people: [] as { id: string; data: Record<string, unknown> }[] };
});

/** Reads a dotted field path the way Firestore does, so `stats.queueTier`
 * finds the nested value rather than a key with a dot in it. */
const field = (data: Record<string, unknown>, path: string) =>
  path
    .split(".")
    .reduce<unknown>(
      (value, key) => (value as Record<string, unknown> | undefined)?.[key],
      data,
    );

// The recorded `where`s are applied rather than ignored: which people a tier
// counts is the whole of what these tests are about.
vi.mock("firebase-admin/firestore", () => {
  const query = (wheres: [string, string, unknown][], limit = Infinity) => {
    const matching = () =>
      people
        .filter((person) =>
          wheres.every(([path, op, value]) => {
            if (op !== "==") {
              throw new Error(`the mock does not know the "${op}" operator`);
            }
            return field(person.data, path) === value;
          }),
        )
        .slice(0, limit);
    const self = {
      where: (path: string, op: string, value: unknown) =>
        query([...wheres, [path, op, value]], limit),
      select: () => self,
      limit: (n: number) => query(wheres, n),
      count: () => ({
        get: async () => ({ data: () => ({ count: matching().length }) }),
      }),
      get: async () => ({
        docs: matching().map((person) => ({
          id: person.id,
          get: (path: string) => field(person.data, path),
        })),
      }),
    };
    return self;
  };
  return { getFirestore: () => ({ collection: () => query([]) }) };
});

const person = (
  id: string,
  queueTier: number,
  { published = false, voted = false } = {},
) => ({
  id,
  data: {
    type: "person",
    name: `Osoba ${id}`,
    published,
    stats: {
      queueTier,
      isApproved: published,
      votes: { humanVoted: voted },
    },
  },
});

const call = () =>
  (handler as unknown as (event: unknown) => Promise<unknown>)({});

/** How many people are left in each difficulty tier, for the cards on /pomoc.
 *
 * The number is there for motivation - „ile jeszcze jest do zrobienia”, in the
 * owner's words - so it has to be the people the card's link still hands out,
 * and it has to go down when a volunteer does one of them. */
describe("/api/stats/queueTiers", () => {
  it("leaves out the people somebody has already voted on", async () => {
    people.splice(
      0,
      people.length,
      person("fresh", 1),
      person("another", 1),
      // Voted on, not published: the queue the card links to hides them
      // (`hideVoted: "no_votes"`), and a vote is the whole of what a
      // volunteer's check leaves behind. Counting them would print a number
      // no amount of checking brings down - only an editor publishing does.
      person("voted", 1, { voted: true }),
      person("published", 1, { published: true, voted: true }),
      person("tier2", 2),
    );

    const { tiers } = (await call()) as {
      tiers: { tier: number; toCheck: number | null }[];
    };

    expect(tiers.map(({ tier, toCheck }) => [tier, toCheck])).toEqual([
      [1, 2],
      [2, 1],
      [3, 0],
    ]);
  });

  it("offers the published people of a tier as its examples", async () => {
    people.splice(
      0,
      people.length,
      person("fresh", 1),
      person("published", 1, { published: true, voted: true }),
    );

    const { tiers } = (await call()) as {
      tiers: { tier: number; examples: { id: string; name: string }[] }[];
    };

    expect(tiers[0]!.examples).toEqual([
      { id: "published", name: "Osoba published" },
    ]);
  });
});
