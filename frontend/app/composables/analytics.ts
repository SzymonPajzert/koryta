/** The one way the app sends a custom event to Plausible.
 *
 * `useTrackEvent` takes any string and any properties, which is how a goal ends
 * up misspelled - recorded, and invisible on a dashboard that was only told
 * about the correct spelling - and how one call site ends up sending `kind`
 * where another sends `type`. Going through here types both against
 * `shared/analytics.ts`, so a goal that is not registered, or a property set
 * that does not match the goal's, does not compile.
 */

import {
  isPassiveGoal,
  type AnalyticsGoal,
  type GoalPropKeys,
} from "~~/shared/analytics";

/** Plausible stores properties as strings; the tracker's own type says so too.
 * A caller with a count decides how it wants to be bucketed rather than leaving
 * that to a serializer - see `resultBucket`. */
export type AnalyticsProps = Record<string, string>;

/** Properties attached to every event, keyed by property name.
 *
 * Today this is only the experiment arms: `shared/experiments.ts` needs the arm
 * on each goal so the dashboard can be filtered to one arm and every number
 * compared across them, and a property is the only way to do that without a
 * goal per arm.
 *
 * It lives here rather than in the experiments composable to keep the imports
 * pointing one way - experiments knows about analytics, not the reverse.
 *
 * What this deliberately does *not* cover is pageviews. `@nuxtjs/plausible`
 * calls the tracker's `init` itself and passes no `customProperties`, so the
 * pageview it fires on load carries nothing from here. Segmenting bounce rate
 * or visit duration by arm would mean replacing that plugin with one of our
 * own - worth doing if an experiment ever runs on something whose effect is
 * about staying on the page rather than about clicking something.
 */
const globalProps: AnalyticsProps = {};

/** Attach `value` to every event from now on. Idempotent. */
export function setGlobalProp(key: string, value: string): void {
  globalProps[key] = value;
}

/** Goals that carry no properties take one argument; the rest must pass exactly
 * the keys the goal declares. `[…] extends [never]` rather than a bare
 * conditional, because a naked `never` distributes and every goal would look
 * like it takes none. */
type TrackArgs<G extends AnalyticsGoal> = [GoalPropKeys<G>] extends [never]
  ? []
  : [props: Record<GoalPropKeys<G>, string>];

/** Record `goal`.
 *
 * Safe to call from an event handler, and a no-op during SSR - `useTrackEvent`
 * guards on `import.meta.client` itself, and the tracker only exists in the
 * client plugin.
 */
export function trackGoal<G extends AnalyticsGoal>(
  goal: G,
  ...args: TrackArgs<G>
): void {
  const props = { ...globalProps, ...(args[0] ?? {}) };
  useTrackEvent(goal, {
    props,
    // Only sent for the passive ones. A custom event counts towards the bounce
    // rate unless it says otherwise, which is right for a click and wrong for
    // an event that fires because a page loaded - see the note in
    // shared/analytics.ts.
    ...(isPassiveGoal(goal) ? { interactive: false as const } : {}),
  });
}
