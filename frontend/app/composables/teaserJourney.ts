/** How a logged out reader got to a teaser, and where they went from it.
 *
 * The questions `teaser:shown` and `teaser:continued` answer (see
 * `shared/analytics.ts`): did the search box send them, and once they saw what
 * they could not read, did they sign in, go back to keep looking, or stop.
 *
 * Module state rather than storage. Everything here happens inside one tab's
 * single-page session - a pick in the search box and the page it opens, a
 * teaser and the next page - and the site keeps no identifier across visits on
 * purpose (`shared/experiments.ts`), so there is nothing to persist.
 */

import type { Router } from "vue-router";
import {
  teaserDestination,
  type TeaserArrival,
  type TeaserExit,
  type TeaserKind,
  type TeaserSurface,
} from "~~/shared/analytics";
import { trackGoal } from "~/composables/analytics";

/** How long a pick in the search box counts as the reason for the navigation
 * that follows it. A page is rendered well inside this; a reader who picks,
 * walks away and clicks a link later is not „from search". */
const SEARCH_PICK_WINDOW_MS = 10_000;

/** The node the search box last opened, and when. */
let lastPick: { nodeId: string | undefined; at: number } | undefined;

/** The search box opened something. `nodeId` is the page's node, where the
 * entry was one. Call before navigating. */
export function noteSearchPick(nodeId?: string): void {
  lastPick = { nodeId, at: Date.now() };
}

/** Whether the latest pick is recent enough to be what the navigation in
 * flight is for. */
function pickedJustNow(): boolean {
  return !!lastPick && Date.now() - lastPick.at < SEARCH_PICK_WINDOW_MS;
}

/** How the reader reached the teaser for `nodeId`.
 *
 * `search` when the search box opened this very node a moment ago; `entry`
 * when the page is the first of the tab's history - vue-router keeps the
 * previous entry's path in `history.state.back`, and the page a visit lands on
 * has none - and `link` otherwise. Takes the pick, so a reader who comes back
 * to the same person through a link later is not counted as searching again.
 */
export function teaserArrival(
  nodeId: string,
  historyState: { back?: unknown } | null = window.history.state,
): TeaserArrival {
  const fromSearch = pickedJustNow() && lastPick?.nodeId === nodeId;
  lastPick = undefined;
  if (fromSearch) return "search";
  return historyState?.back ? "link" : "entry";
}

/** Reports `teaser:continued` when the reader leaves the teaser at
 * `teaserPath` for another page of the site, once, and stops watching.
 *
 * /login is not counted: that is the teaser's own button, and
 * `teaser:click` and `login:success` say how that went. A reader who closes
 * the tab or goes to another site fires nothing - which is what "stopped
 * there" looks like on the dashboard: teaser:shown and nothing after it.
 *
 * The back button is told apart by the router's history listener, which only
 * hears a pop: it runs while the navigation it starts is still in flight, so
 * the flag is set by the time `afterEach` reads it. Returns the way to stop
 * watching, for when the teaser goes away some other way.
 */
export function watchTeaserExit(
  router: Router,
  teaserPath: string,
  goal: { surface: TeaserSurface; kind: TeaserKind },
): () => void {
  let popped = false;
  const stopListening = router.options.history.listen(() => {
    popped = true;
  });
  const stopAfterEach = router.afterEach((to, from, failure) => {
    const back = popped;
    popped = false;
    if (failure || from.path !== teaserPath || to.path === teaserPath) return;
    stop();
    if (to.path.startsWith("/login")) return;
    const via: TeaserExit = back ? "back" : pickedJustNow() ? "search" : "link";
    trackGoal("teaser:continued", {
      surface: goal.surface,
      kind: goal.kind,
      via,
      to: teaserDestination(to.path),
    });
  });
  function stop() {
    stopListening();
    stopAfterEach();
  }
  return stop;
}
