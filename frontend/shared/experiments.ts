/** A/B experiments: which arm a reader is in, and how that reaches Plausible.
 *
 * ## Why this is deliberately small
 *
 * koryta.pl saw 381 visitors in the last 21 days of the August export - about
 * 18 a day outside a press spike, against a median of 16 over the whole 91-day
 * window. Split three ways that is six readers per arm per day, and the traffic
 * is spike-driven rather than steady: one Facebook post lands 700 people in an
 * afternoon and whichever arm it happens to weight is the one that "wins".
 *
 * The registry shipped **dormant** for exactly that reason, and `home-default`
 * is now **live**: `map` and `graph` carry equal weight. Read the result with
 * the traffic in mind. Six readers per arm per day is not a fortnight's
 * experiment; expect to leave it running for months before the difference
 * between the arms outgrows the noise a single Facebook post puts into it, and
 * prefer `home-explorer:tab` and the two `home-timeline:*` goals - which need
 * no arm to divide by - for anything they can answer on their own.
 *
 * ## The arm is a property, not a goal
 *
 * On a Business plan the arm rides as a custom property on every event
 * (`setGlobalProp` in `app/composables/analytics.ts`), so the dashboard can be
 * filtered to one arm and *every* goal compared across them. That is a
 * different and much better measurement than a goal per arm would have been:
 * with a goal you can only count conversions, with a property you can ask what
 * each arm's readers went on to do.
 *
 * One goal remains - `experiment:assigned` - and it is there to give each arm a
 * denominator. It is passive, so being sorted into an arm does not by itself
 * count as engagement.
 *
 * ## Stickiness is per session, on purpose
 *
 * The arm is held in `sessionStorage`, not a cookie. Two reasons, and the
 * second is the real one:
 *
 * 1. Plausible is cookieless, and the site says so. Setting an identifier
 *    cookie to run an experiment on top of it would be a bigger change to what
 *    the site does with its readers than the experiment is worth.
 * 2. Plausible's own notion of a visitor is a hash that rotates daily. Pinning
 *    an arm for 90 days while the analytics re-identifies the same person every
 *    morning does not buy a longer measurement - it just puts one reader's
 *    later visits in a different bucket from their first, which is noise. A
 *    session is the unit the numbers are actually reported in.
 *
 * ## How the flash was dealt with, and what it cost
 *
 * `routeRules` caches `/` with `swr: 3600` (`nuxt.config.ts`), so the server
 * renders the home page once an hour and hands the same html to everybody. The
 * arm cannot be decided server-side as things stand - the session id lives in
 * `sessionStorage`, and the cookie that would let the server see it is the one
 * thing the stickiness note above rules out - so it is resolved after
 * hydration. Committing the server render to a panel would therefore mean one
 * arm painting the other's panel for a frame and then swapping while the
 * control sat still: an asymmetry between the arms in the very thing being
 * compared.
 *
 * `HomeExplorer` renders **neither** panel until the arm is known, behind a
 * placeholder of the map panel's height. Both arms pass through it, so the
 * comparison is between the panels rather than between one panel and one panel
 * plus a swap. The price is that the map is no longer server-rendered on `/`,
 * which is paid by every reader and not only by the ones in an arm.
 *
 * The two alternatives, if that price turns out to be the wrong one:
 *   - drop `swr` on `/` and render per request, which does not help on its own
 *     - the server still has no way to know the arm - but is the prerequisite
 *     for the next one;
 *   - vary the cache key on an arm header set by a server middleware, which is
 *     one cache entry per arm and no placeholder, but moves the assignment to
 *     the server where it has to agree with the client's and depends on the CDN
 *     honouring the `Vary`.
 */

/** One arm of an experiment. `weight` is relative, not a percentage - the
 * weights are summed and each arm gets its share, so `[1, 1, 1]` and
 * `[10, 10, 10]` mean the same thing and a zero-weight arm is simply off. */
export type ExperimentArm<Id extends string = string> = {
  id: Id;
  weight: number;
  /** What this arm shows, for whoever reads the results later. */
  description: string;
};

export type Experiment<Id extends string = string> = {
  id: string;
  /** The question the split is meant to answer, in one sentence. */
  question: string;
  arms: ExperimentArm<Id>[];
};

/** Which panel the home page opens on.
 *
 * `map` and `graph` are split evenly. `map` is first, and so the control that
 * `assignArm` falls back to: it is what the page has always opened on, and a
 * reader whose storage is unavailable should get the familiar page rather than
 * the one being tested.
 *
 * The `parties` arm went with its panel - the treemap was removed from the tab
 * strip, and an arm naming a panel that no longer exists is a trap rather than
 * a placeholder. `gry` is different: it is declared with no weight and no
 * implementation because the games hub lives on the `gry-games` branch, and
 * naming the arm here is what keeps the eventual three-way split from being a
 * redesign - see `assignArm`, which falls back to the first arm for anything it
 * does not recognise, and `HomeExplorer`, which stays on the map for a panel it
 * cannot render. */
export const HOME_DEFAULT_EXPERIMENT = {
  id: "home-default",
  question:
    "Which of the home explorer's panels should a first-time reader land on?",
  arms: [
    {
      id: "map",
      weight: 1,
      description:
        "Mapa koryciarstwa, the panel the page has always opened on.",
    },
    {
      id: "graph",
      weight: 1,
      description:
        "Stanowiska w czasie, the timeline of how many people each party, województwo or sector had in post.",
    },
    {
      id: "gry",
      weight: 0,
      description:
        "The /gry hub. Not built on main - the arm is declared so activating it is a weight change plus a panel, and the goal already exists in Plausible.",
    },
  ],
} as const satisfies Experiment;

export type HomeDefaultArm =
  (typeof HOME_DEFAULT_EXPERIMENT)["arms"][number]["id"];

export const EXPERIMENTS = {
  "home-default": HOME_DEFAULT_EXPERIMENT,
} as const;

export type ExperimentId = keyof typeof EXPERIMENTS;

/** The property name an experiment's arm is reported under.
 *
 * Keyed by experiment rather than a single `arm` property, so two experiments
 * running at once do not overwrite each other on the same event. */
export function armPropertyName(experimentId: string): string {
  return `arm:${experimentId}`;
}

/** A stable number in [0, 1) from an arbitrary string.
 *
 * FNV-1a. It is not a good hash and does not need to be - it needs to be the
 * same in a test as in a browser, to have no dependency, and to spread a few
 * thousand random session ids evenly across three buckets. Math.random() is
 * what actually assigns; this only turns an id into a position so that the
 * assignment is a pure function of it and can be asserted on. */
export function hashToUnitInterval(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // The FNV prime, by shift-add rather than multiplication: `hash * 16777619`
    // overflows a double's exact-integer range and stops being reproducible.
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  // >>> 0 reads the low 32 bits as unsigned; without it the sign bit makes half
  // the inputs negative and every one of those lands in the first arm.
  return (hash >>> 0) / 4294967296;
}

/** Which arm `sessionId` belongs to.
 *
 * Falls back to the first arm - never to nothing - so that a mistyped weight,
 * an experiment whose arms all sit at zero, or an id that hashes to exactly 1
 * shows the reader the control rather than an empty panel. */
export function assignArm<Id extends string>(
  experiment: Experiment<Id>,
  sessionId: string,
): Id {
  const arms = experiment.arms;
  const control = arms[0]!.id;

  const total = arms.reduce((sum, arm) => sum + Math.max(0, arm.weight), 0);
  if (total <= 0) return control;

  let position = hashToUnitInterval(`${experiment.id}:${sessionId}`) * total;
  for (const arm of arms) {
    position -= Math.max(0, arm.weight);
    if (position < 0) return arm.id;
  }
  return control;
}
