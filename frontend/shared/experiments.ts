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
 * So the registry shipped **dormant**, every reader on the map, and turning an
 * experiment on is changing its weights - with the goals already registered so
 * no data is lost to a forgotten dashboard step. `home-default` went live on
 * 2026-11-15 as a three-way split and became a two-way one on 2026-11-20; at
 * ~415 home visitors a month that is ~200 readers an arm, so read it in months,
 * not days.
 *
 * Before spending traffic on the split, read `home-explorer:tab` broken down by
 * `tab`, and `home-explorer:pick` broken down by `panel` (`shared/analytics.ts`).
 * The tab strip is already switchable, so how many people leave the panel they
 * landed on - and what each panel converts once opened - is observable for free, at
 * full sample size, with no arm to divide by. An experiment is only worth
 * running if those numbers are ambiguous.
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
 * ## Why a live split hides the panels until the arm is set
 *
 * `routeRules` caches `/` with `swr: 3600` (`nuxt.config.ts`), so the server
 * renders the home page once an hour and hands the same html to everybody. The
 * arm therefore cannot be decided server-side, and is resolved after hydration
 * - which would have a reader in a non-default arm see the map for a frame
 * before the tab switched. Control has no such swap, so the flash would be an
 * asymmetry between the arms and would bias the very comparison being run.
 *
 * Of the ways out (drop `swr` on `/`; vary the cache on an arm set by a server
 * middleware; hide the panels until the browser has the arm) the third was
 * picked when `home-default` went live: `HomeExplorer` keeps its panels laid
 * out but unpainted until the arm is set, for every arm alike, so each one
 * waits the same moment and none shows another's panel. While an experiment is
 * dormant nothing waits (`experimentIsLive`).
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
 * Live since round oswiadczenia-osoby-r2 (2026-11-15), a third each for the
 * map, the chart and the declarations. Half the map and half the declarations
 * since the decision on 2026-11-20: the chart is the third tab and no arm opens
 * on it, so read the split from that rollout on. `gry` still off.
 * `HomeExplorer` hides its panels until the arm is set, for every arm alike,
 * so no arm paints another's panel first (the flash the note at the top
 * describes).
 *
 * `parties` was the second arm and went with its panel: the treemap was removed
 * from the tab strip, and an arm naming a panel that no longer exists is a trap
 * rather than a placeholder. `graph` replaces it and names the panel that took
 * its tab. `gry` is different again - declared with no weight and no
 * implementation, because the games hub lives on the `gry-games` branch, and
 * naming the arm here is what keeps the eventual three-way split from being a
 * redesign. See `assignArm`, which falls back to the first arm for anything it
 * does not recognise. */
export const HOME_DEFAULT_EXPERIMENT = {
  id: "home-default",
  question:
    "Which of the home explorer's panels should a first-time reader land on?",
  arms: [
    {
      id: "map",
      weight: 1,
      description:
        "Mapa koryciarstwa, the panel the page opened on before the split.",
    },
    {
      id: "graph",
      weight: 0,
      description:
        "Stanowiska w czasie, the timeline of how many people each party, województwo or sector had in post.",
    },
    {
      id: "gry",
      weight: 0,
      description:
        "The /gry hub. Not built on main - the arm is declared so activating it is a weight change plus a panel, and the goal already exists in Plausible.",
    },
    {
      id: "oswiadczenia",
      weight: 1,
      description:
        "Oświadczenia majątkowe: how far the asset declarations got, in people, with the ways on to /oswiadczenia, /oswiadczenia/postep and the blog post. Opens only when the night's people snapshot exists; otherwise the reader gets the map.",
    },
  ],
} as const satisfies Experiment;

export type HomeDefaultArm =
  (typeof HOME_DEFAULT_EXPERIMENT)["arms"][number]["id"];

/** Whether a reader who is not signed in gets the ask above a person's history
 * to read a few declaration scans (`PersonReadingAsk`).
 *
 * Live from its first rollout, decided on 2026-11-17: half and half, because
 * the ask might put readers off the rest of the page as much as it brings them
 * to /oswiadczenia. Control is the page without it, which is also what the
 * server renders: the box appears only once the browser is in the other arm,
 * so no reader of the control sees it for a frame.
 *
 * Person pages draw ~40-50 signed-out sessions a weekday (November), ~20-25 an
 * arm: two weeks tell a bounce difference of ten points or so, four weeks
 * about eight. The read is task evaluate-the-osoba-skany-experiment. */
export const PERSON_ASK_EXPERIMENT = {
  id: "osoba-skany",
  question:
    "Does the ask to read a few declaration scans, above a person's history, put readers off the rest of the site, and does it bring them to /oswiadczenia?",
  arms: [
    {
      id: "bez",
      weight: 1,
      description: "The person page without the ask, as before it.",
    },
    {
      id: "prosba",
      weight: 1,
      description:
        "The ask above „Historia powiązań” (board round osoba-skany-r3, moved above it on 2026-11-17): how many people were published automatically in 30 days, „Strony jak ta powstały dzięki czytelnikom” and „Odczytaj skany” to /oswiadczenia.",
    },
  ],
} as const satisfies Experiment;

export type PersonAskArm = (typeof PERSON_ASK_EXPERIMENT)["arms"][number]["id"];

export const EXPERIMENTS = {
  "home-default": HOME_DEFAULT_EXPERIMENT,
  "osoba-skany": PERSON_ASK_EXPERIMENT,
} as const;

export type ExperimentId = keyof typeof EXPERIMENTS;

/** Whether readers are split at all: two arms or more carry weight. A
 * dormant experiment hands everybody its control, and nothing need wait for
 * the assignment. */
export function experimentIsLive(experiment: Experiment): boolean {
  return experiment.arms.filter((arm) => arm.weight > 0).length > 1;
}

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
