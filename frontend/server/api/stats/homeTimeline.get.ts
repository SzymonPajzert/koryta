import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import {
  postTimelines,
  type HomeTimelineResponse,
} from "~~/server/utils/postTimelines";
import { warsawDate } from "~~/shared/dates";

export {
  timelineGroupings,
  type HomeTimelineResponse,
  type TimelineGrouping,
} from "~~/server/utils/postTimelines";

/** How many people held a post each month, split three ways.
 *
 * Feeds the „Wykres” panel of the home page explorer - the busiest route on the
 * site - so it is cached hard on both sides: a day in `postTimelines`, keyed on
 * the Warsaw day, behind the six-hour response cache every public endpoint has.
 */
export default editorFreshCachedEventHandler(
  async (): Promise<HomeTimelineResponse> =>
    (await postTimelines(warsawDate())).home,
  { name: "api-stats-homeTimeline" },
);
