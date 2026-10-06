import { defineEventHandler, readValidatedBody } from "h3";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import {
  jobRequestSchema,
  requestPeopleRun,
} from "~~/server/utils/jobRequests";
import { runLink } from "~~/shared/jobs";

/** Queue a run sending a company's people, or a person, to the site - the
 * button on their page. The datascience group only: the run writes through
 * the ingest, which takes the pipelines' word for who is who. Answers with the
 * run and the /admin/procesy link that follows it; a page with a run already
 * waiting or going gets that one (`reused`). */
export default defineEventHandler(async (event) => {
  const user = requireDatascience(await getUser(event));
  const input = await readValidatedBody(event, (body) =>
    jobRequestSchema.parse(body),
  );
  const { run, reused } = await requestPeopleRun(input, user);
  return { run, reused, link: runLink(run.id) };
});
