/** Reading which experiment arm the current reader is in.
 *
 * The registry, the assignment rule and the reasoning about traffic and
 * stickiness all live in `shared/experiments.ts`; this is only the part that
 * needs a browser.
 */

import {
  assignArm,
  experimentGoal,
  type Experiment,
} from "~~/shared/experiments";
import { trackExperimentGoal } from "~/composables/analytics";

/** Where the per-session id lives. One key for the whole site: the id
 * identifies the session, not the experiment, so two experiments running at
 * once assign independently (the experiment id is hashed in with it) while
 * still describing the same reader. */
const SESSION_KEY = "koryta:session";

/** Prefix for the "already reported this arm" flag, one per experiment. */
const REPORTED_PREFIX = "koryta:exp-reported:";

/** The current session's id, creating one if this is the first call.
 *
 * `sessionStorage` rather than a cookie, and rather than `localStorage`: see
 * the stickiness note in `shared/experiments.ts`. Returns null when storage is
 * unavailable - Safari in private mode has historically thrown on write, and an
 * analytics detail is not worth an exception on the home page. Every caller
 * treats null as "control".
 */
function sessionId(): string | null {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    // Math.random rather than crypto.randomUUID: this is not a secret, it
    // never leaves the browser, and randomUUID is undefined on an insecure
    // origin - which is every local build. Two random suffixes and a timestamp
    // is far more than enough to keep a few thousand concurrent sessions in
    // different buckets, and a collision would cost one misassigned arm.
    const created = [
      Date.now().toString(36),
      Math.random().toString(36).slice(2),
      Math.random().toString(36).slice(2),
    ].join("-");
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return null;
  }
}

/** Whether this session has already reported `experimentId`, marking it as
 * reported if not. Storage failures report every time rather than never: a
 * duplicated marker inflates one number, a suppressed one loses the arm. */
function claimReport(experimentId: string): boolean {
  try {
    const key = `${REPORTED_PREFIX}${experimentId}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

/** The arm this reader is in, and a record of it in Plausible.
 *
 * Starts on the control arm and stays there through SSR, because `/` is served
 * from a shared `swr` cache and cannot vary per reader - the arm is resolved on
 * mount. A non-control arm therefore paints control for a frame; that is the
 * asymmetry `shared/experiments.ts` says to fix before activating a split, and
 * it is invisible while every experiment is dormant.
 *
 * The marker goal is sent once per session per experiment, on assignment. Once,
 * because the dashboard reading is "filter to visitors who converted this goal"
 * - a per-pageview marker would still segment correctly but would report an arm
 * size that is really a pageview count, which is the number one is trying not
 * to confuse it with.
 */
export function useExperimentArm<Id extends string>(
  experiment: Experiment<Id>,
): Ref<Id> {
  const control = experiment.arms[0]!.id;
  const arm = ref(control) as Ref<Id>;

  onMounted(() => {
    const id = sessionId();
    if (!id) return;

    arm.value = assignArm(experiment, id);

    if (claimReport(experiment.id)) {
      trackExperimentGoal(experimentGoal(experiment.id, arm.value), {
        experiment: experiment.id,
        arm: arm.value,
      });
    }
  });

  return arm;
}
