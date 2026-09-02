/** The one way the app sends a custom event to Plausible.
 *
 * `useTrackEvent` takes any string, which is how a goal ends up misspelled,
 * recorded, and invisible on a dashboard that was only ever told about the
 * correct spelling. Going through here types the name against the vocabulary in
 * `shared/analytics.ts`, so a goal that is not registered does not compile.
 */

import type { AnalyticsGoal } from "~~/shared/analytics";

/** Values Plausible accepts for a property.
 *
 * Strings only, which is the tracker's own `CustomProperties` type rather than
 * a restriction added here: the API stores properties as strings and a number
 * would be coerced on the way out, so a caller with a count should decide how
 * it wants to be bucketed rather than leave that to the serializer. */
export type AnalyticsProps = Record<string, string>;

/** Record `goal`.
 *
 * Safe to call from an event handler, and a no-op during SSR - `useTrackEvent`
 * guards on `import.meta.client` itself, and the tracker only exists in the
 * client plugin.
 *
 * `props` are sent even though the site's Growth plan discards them. They cost
 * nothing, they document at the call site what the interesting dimension was,
 * and if the plan ever changes the breakdowns start appearing without another
 * pass over every caller. Do not use one in place of a goal name: on Growth a
 * property is not a thing you can filter or group by, so a dimension that
 * matters belongs in the name. See `shared/analytics.ts`.
 */
export function trackGoal(goal: AnalyticsGoal, props?: AnalyticsProps): void {
  useTrackEvent(goal, props ? { props } : undefined);
}

/** Record an arm-marker goal.
 *
 * Separate from `trackGoal` because the name is built from the experiment
 * registry rather than taken from the fixed vocabulary, so it cannot be typed
 * as an `AnalyticsGoal`. Only `useExperimentArm` should call it. */
export function trackExperimentGoal(
  goal: string,
  props?: AnalyticsProps,
): void {
  useTrackEvent(goal, props ? { props } : undefined);
}
