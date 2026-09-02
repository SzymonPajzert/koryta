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
 * So the registry below ships **dormant** - `home-default` gives every reader
 * the map, exactly what the site does today, and the only thing the experiment
 * machinery does is exist. Turning it on is changing the weights, and the goals
 * are already registered so no data is lost to a forgotten dashboard step.
 *
 * Before spending traffic on the split, read `home-explorer:tab-parties`
 * (`shared/analytics.ts`). The tab strip is already switchable, so how many
 * people open the treemap at all is observable for free, at full sample size,
 * with no arm to divide by. An experiment is only worth running if that number
 * is ambiguous.
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
 * ## The one thing to fix before activating
 *
 * `routeRules` caches `/` with `swr: 3600` (`nuxt.config.ts`), so the server
 * renders the home page once an hour and hands the same html to everybody. The
 * arm therefore cannot be decided server-side as things stand, and is resolved
 * after hydration - which means a reader in a non-default arm sees the map for
 * a frame before the tab switches. Control has no such swap, so the flash is an
 * asymmetry between the arms and would bias the very comparison being run.
 *
 * Two ways out when the time comes, neither free:
 *   - drop `swr` on `/`, and pay a full render per request on a container that
 *     runs at `minInstances: 0`; or
 *   - keep `swr` and vary the cache key on an arm header set by a server
 *     middleware, which is one cache entry per arm and no flash, but puts the
 *     assignment on the server where it has to agree with the client's.
 * Deciding that is part of activating the experiment, not of shipping this.
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
 * All the weight is on `map`, which is what `HomeExplorer` has always defaulted
 * to, so this changes nothing until somebody moves it. `gry` is declared with
 * no weight and no implementation: the games hub lives on the `gry-games`
 * branch, and naming the arm here is what keeps the eventual three-way split
 * from being a redesign - see `useExperiment`, which falls back to the first
 * arm for anything it does not recognise. */
export const HOME_DEFAULT_EXPERIMENT = {
  id: "home-default",
  question:
    "Which of the home explorer's panels should a first-time reader land on?",
  arms: [
    {
      id: "map",
      weight: 1,
      description: "Mapa koryciarstwa, the panel the page opens on today.",
    },
    {
      id: "parties",
      weight: 0,
      description: "Podział na partie, the treemap that is currently a tab.",
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

/** The goal that records which arm a reader was assigned to.
 *
 * On a Growth plan this marker is the *only* way to segment the other goals:
 * custom properties do not exist, but the dashboard can be filtered to visitors
 * who completed a given goal. So the reading is "filter to
 * `exp:home-default:parties`, then look at `home-parties:party`" - which is why
 * the arm has to be its own goal rather than a property on the others. */
export function experimentGoal(experimentId: string, armId: string): string {
  return `exp:${experimentId}:${armId}`;
}

/** Every arm-marker goal, including the arms currently at zero weight.
 *
 * Zero-weight arms are included deliberately: registering a goal in Plausible
 * is a manual dashboard step, and the point of this list is that activating an
 * experiment never needs one. */
export const EXPERIMENT_GOALS: string[] = Object.values(EXPERIMENTS)
  .flatMap((experiment) =>
    experiment.arms.map((arm) => experimentGoal(experiment.id, arm.id)),
  )
  .sort();

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
