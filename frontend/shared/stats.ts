import type { NodeStats, VoteDocument, Note, Edge } from "./model";
import { pageIsPublic } from "./model";
import { namesASupervisorySeat } from "./companyBodies";

export function calculateExperience(edges: Edge[]): number {
  const intervals: { start: number; end: number }[] = [];

  for (const edge of edges) {
    if (edge.type === "employed") {
      const startStr =
        edge.start_date && typeof edge.start_date === "string"
          ? edge.start_date.split("T")[0]
          : null;
      const endStr =
        edge.end_date && typeof edge.end_date === "string"
          ? edge.end_date.split("T")[0]
          : null;

      const start = startStr ? new Date(startStr).getTime() : null;
      const end = endStr ? new Date(endStr).getTime() : new Date().getTime();

      if (start && !isNaN(start) && !isNaN(end)) {
        if (start <= end) {
          intervals.push({ start, end });
        }
      }
    }
  }

  if (intervals.length === 0 || intervals[0] === undefined) {
    return 0;
  }
  intervals.sort((a, b) => a.start - b.start);

  const result = intervals.reduce<{
    mergedExperienceMs: number;
    start: number;
    end: number;
  }>(
    (acc, nextInterval) => {
      if (nextInterval.start <= acc.end) {
        acc.end = Math.max(acc.end, nextInterval.end);
      } else {
        acc.mergedExperienceMs += acc.end - acc.start;
        acc.start = nextInterval.start;
        acc.end = nextInterval.end;
      }
      return acc;
    },
    { mergedExperienceMs: 0, start: intervals[0].start, end: intervals[0].end },
  );

  result.mergedExperienceMs += result.end - result.start;

  const experienceMonths =
    result.mergedExperienceMs / (1000 * 60 * 60 * 24 * 30.44);
  return Math.floor((experienceMonths / 12) * 10) / 10;
}

export function calculateCurrentlyEmployed(edges: Edge[]): boolean {
  for (const edge of edges) {
    if (edge.type === "employed") {
      if (!edge.end_date) {
        return true;
      }
      const end = new Date(edge.end_date).getTime();
      if (!isNaN(end) && end >= new Date().getTime()) {
        return true;
      }
    }
  }
  return false;
}

export function calculateLatestEmploymentStart(edges: Edge[]): string | null {
  let latest: string | null = null;
  for (const edge of edges) {
    if (edge.type === "employed") {
      const startStr =
        edge.start_date && typeof edge.start_date === "string"
          ? edge.start_date.split("T")[0]
          : null;

      if (startStr) {
        if (!latest || startStr > latest) {
          latest = startStr;
        }
      }
    }
  }
  return latest;
}

/** Whether a vote was cast by a scoring model rather than by a person.
 *
 * The pipeline runs several models and each votes under its own uid -
 * `pipeline`, `pipeline-pagerank`, `pipeline-turnover` and so on. Matching on
 * the substring rather than on the exact name is safe because a Firebase uid is
 * 28 random alphanumerics and cannot contain a word. Mirrored in Python by
 * `is_pipeline_uid` in `data/pipelines/src/entities/person.py`, which is what
 * keeps the models from being seeded on their own output.
 */
export function isPipelineUid(uid: string | undefined | null): boolean {
  return !!uid && uid.includes("pipeline");
}

/** Whether a write was made by a one-time migration script rather than by a
 * person.
 *
 * Every script under `scripts/migrate/` that files revisions or audit entries
 * signs them `migration:<script-name>` - see `AUTHOR` in
 * `merge-duplicate-people.ts` and its neighbours. Matching on the prefix is
 * safe for the same reason `isPipelineUid` matches on a substring: a Firebase
 * uid is 28 random alphanumerics and cannot contain a colon.
 *
 * The signature is deliberate and worth keeping. A merge, a category backfill
 * or a date repair is a change somebody has to be able to trace, and the uid is
 * what says which run made it - so these writes are attributed, not anonymous.
 * What they are not is somebody's afternoon: one run of
 * `merge-duplicate-people` files a revision per collapsed relation and an audit
 * entry per merged page, all inside a few minutes - 1,081 revisions on
 * 2026-08-31, against 160 for the second-busiest human in the whole export.
 */
export function isMigrationUid(uid: string | undefined | null): boolean {
  return !!uid && uid.startsWith("migration:");
}

/** Whether a uid is one the site writes under itself, rather than a person.
 *
 * The union of the two, for the places that are counting *work people did* and
 * have no reason to tell one kind of robot from the other. The vote aggregate
 * is not one of them: it needs the pipeline's verdicts specifically, which is
 * why it still asks `isPipelineUid`.
 */
export function isAutomatedUid(uid: string | undefined | null): boolean {
  return isPipelineUid(uid) || isMigrationUid(uid);
}

/**
 * The vote aggregate stored on a node: what people said, plus the pipeline's
 * best guess.
 *
 * Human votes sum, because each is somebody's independent opinion and two
 * people saying +3 is a stronger claim than one. Pipeline votes do not: the
 * models look at the same data from different angles and largely agree, so
 * summing them would say "five voters" where there is one dataset, and adding
 * a sixth model would silently rescale a number the explore table sorts on and
 * `bucketPublicationCandidates` cuts into 1-5 bands. Instead every model's
 * verdict collapses to the highest of them - a model that spots somebody the
 * others miss still surfaces them, and one that has nothing to say costs
 * nothing.
 *
 * `models` keeps each model's own score so a reader can see which one
 * nominated a person. `lastVotedAt` deliberately ignores the pipeline: it
 * reads as "when did somebody last look at this", and a nightly re-scoring is
 * not somebody looking.
 */
export function computeVoteStats(
  nodeVotes: VoteDocument[],
): Record<string, unknown> {
  const aggregatedVotes: Record<string, unknown> = {
    interesting: 0,
    quality: 0,
    humanVoted: false,
  };

  let latestDate: Date | null = null;
  const pipelineBest: Record<string, number> = {};
  const models: Record<string, number> = {};

  for (const v of nodeVotes) {
    const fromPipeline = isPipelineUid(v.userUid);
    if (!fromPipeline) {
      aggregatedVotes.humanVoted = true;
      if (v.updatedAt) {
        const d = new Date(v.updatedAt);
        if (!latestDate || d > latestDate) {
          latestDate = d;
        }
      }
    }

    for (const [category, value] of Object.entries(v.categoryVotes)) {
      if (fromPipeline) {
        const best = pipelineBest[category];
        pipelineBest[category] =
          best === undefined
            ? (value as number)
            : Math.max(best, value as number);
      } else {
        aggregatedVotes[category] =
          ((aggregatedVotes[category] as number) || 0) + (value as number);
      }
    }

    const interesting = v.categoryVotes.interesting;
    if (fromPipeline && typeof interesting === "number") {
      models[v.userUid] = interesting;
    }
  }

  for (const [category, best] of Object.entries(pipelineBest)) {
    aggregatedVotes[category] =
      ((aggregatedVotes[category] as number) || 0) + best;
  }

  if (Object.keys(models).length > 0) {
    aggregatedVotes.models = models;
  }

  if (latestDate) {
    aggregatedVotes.lastVotedAt = latestDate.toISOString();
  }

  return aggregatedVotes;
}

/** Keeps only employment the site counts: a paid post, in a place the public
 * sector is known to own.
 *
 * The explore table reports experience and the latest employment date for
 * public institutions only — time spent in a private company is not what the
 * site tracks. Known is the operative word: a place whose ownership nobody
 * could establish is left out too, so these numbers are a floor rather than a
 * count. See `Company.isPublic` for why that gap exists.
 *
 * `unpaidSeatPlaceIds` takes out the seats that are not posts. A samodzielny
 * publiczny zakład opieki zdrowotnej is supervised by a rada społeczna, whose
 * members are delegates of the founding authority and are not paid for sitting
 * on it — so it is out for the same reason a private employer is, and 892 such
 * seats are stored across 238 hospitals. Which places those are is a claim
 * about the institution (`Company.supervisoryBody`); which of a person's edges
 * are seats on that organ rather than jobs at it is a claim about the role, so
 * both have to hold. See `shared/companyBodies.ts`.
 */
function publicEmployment(
  edges: Edge[],
  publicPlaceIds: ReadonlySet<string>,
  unpaidSeatPlaceIds: ReadonlySet<string>,
): Edge[] {
  return edges.filter(
    (e) =>
      e.type === "employed" &&
      publicPlaceIds.has(e.target) &&
      !(unpaidSeatPlaceIds.has(e.target) && namesASupervisorySeat(e.name)),
  );
}

export function computeEdgeStats(
  nodeEdges: Edge[],
  publicPlaceIds: ReadonlySet<string>,
  transitiveTargets: Record<string, string[]> = {},
  /** Places whose supervisory organ is one nobody is paid to sit on. Defaults
   * to none, so a caller that has not worked them out keeps the numbers it
   * computed before this existed rather than silently dropping seats it cannot
   * classify. */
  unpaidSeatPlaceIds: ReadonlySet<string> = new Set(),
) {
  // A removed relation is not a quiet one. `/api/edges/delete` and a merge's
  // `collapsed` verdict both keep the document and set `deleted: true` - 775 of
  // the 43,656 stored on 2026-08-31, touching 615 nodes - so without this every
  // counter below goes on asserting a tie somebody has already taken off the
  // graph. `pageIsPublic` catches it for the `approved` scope only, which left
  // the `all` scope - the one a logged-in editor's table is filtered and sorted
  // by - reading them as live: 165 of the 171 people merged away that day kept
  // the employer, the region and the `currentlyEmployed` flag of the relation
  // that had just been folded into the survivor, which is what put them back in
  // /eksploruj/tabela after a `computeNodes` run rather than out of it.
  const liveEdges = nodeEdges.filter((e) => e.deleted !== true);

  const approvedEdges = liveEdges.filter((e) => pageIsPublic(e));
  const publicEdges = publicEmployment(
    liveEdges,
    publicPlaceIds,
    unpaidSeatPlaceIds,
  );
  const publicApprovedEdges = publicEmployment(
    approvedEdges,
    publicPlaceIds,
    unpaidSeatPlaceIds,
  );

  const allTargetNodeIds = [
    ...new Set(
      liveEdges.flatMap((e) => [
        e.target,
        ...(transitiveTargets[e.target] || []),
      ]),
    ),
  ].filter(Boolean);

  const approvedTargetNodeIds = [
    ...new Set(
      approvedEdges.flatMap((e) => [
        e.target,
        ...(transitiveTargets[e.target] || []),
      ]),
    ),
  ].filter(Boolean);

  // Which companies this node is the registered seat of, kept apart from
  // `targetNodeIds` because that list is type-blind and now mixes two claims: a
  // region's targets are the companies seated in it *and* the companies it
  // holds shares in. `regionsByPlaceId` reads this one, so a gmina that owns a
  // company in the next town cannot move it there.
  //
  // No transitive fold: a seat is asserted about one region, and rolling the
  // wojewodztwo in would put every company in Poland's largest region into a
  // tie with its own powiat.
  const seatTargets = (edges: Edge[]) =>
    [
      ...new Set(edges.filter((e) => e.type === "seat").map((e) => e.target)),
    ].filter(Boolean);

  return {
    all: {
      experienceMonths: calculateExperience(publicEdges),
      latestEmploymentStart: calculateLatestEmploymentStart(publicEdges),
      targetNodeIds: allTargetNodeIds,
      seatNodeIds: seatTargets(liveEdges),
      currentlyEmployed: calculateCurrentlyEmployed(publicEdges),
      currentlyEmployedTargetNodeIds: [
        ...new Set(
          publicEdges
            .filter((e) => calculateCurrentlyEmployed([e]))
            .flatMap((e) => [e.target, ...(transitiveTargets[e.target] || [])]),
        ),
      ].filter(Boolean),
    },
    approved: {
      experienceMonths: calculateExperience(publicApprovedEdges),
      latestEmploymentStart:
        calculateLatestEmploymentStart(publicApprovedEdges),
      targetNodeIds: approvedTargetNodeIds,
      seatNodeIds: seatTargets(approvedEdges),
      currentlyEmployed: calculateCurrentlyEmployed(publicApprovedEdges),
      currentlyEmployedTargetNodeIds: [
        ...new Set(
          publicApprovedEdges
            .filter((e) => calculateCurrentlyEmployed([e]))
            .flatMap((e) => [e.target, ...(transitiveTargets[e.target] || [])]),
        ),
      ].filter(Boolean),
    },
  };
}

export function computeNodeStats(
  nodeIsApproved: boolean,
  nodeEdges: Edge[],
  nodeNotes: Note[],
  nodeVotes: VoteDocument[],
  publicPlaceIds: ReadonlySet<string>,
  transitiveTargets: Record<string, string[]> = {},
  unpaidSeatPlaceIds: ReadonlySet<string> = new Set(),
): NodeStats {
  return {
    isApproved: nodeIsApproved,
    // We're interested in the total number of sources
    notesCount: nodeNotes
      .map((n) => n.sources?.length || 0)
      .reduce((a, b) => a + b, 0),
    votes: computeVoteStats(nodeVotes),
    edges: computeEdgeStats(
      nodeEdges,
      publicPlaceIds,
      transitiveTargets,
      unpaidSeatPlaceIds,
    ),
  };
}
