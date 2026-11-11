import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getRouterParam, type H3Event } from "h3";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { importedOrReviewed } from "~~/server/utils/provenance";
import { asArray, pageIsPublic } from "~~/shared/model";
import type { Edge, Person } from "~~/shared/model";
import type { RegionRun, RegionRuns } from "~~/shared/electionLists";
import { candidacyElection } from "~~/shared/electionDays";
import { newestLocalElection } from "~~/shared/regionAuthorities";

/** A backstop rather than a budget: the most candidacies any region held on
 * the 2026-11-11 export was 1,404, in Województwo mazowieckie. */
const RUNS_PER_REGION = 5000;

type Stored<T> = T & { id: string };

/** A node as stored, before anything has said what it is: the id in the url
 * and the edges' sources are anybody's to point at anything. */
type StoredNode = {
  id: string;
  type?: string;
  name?: string;
  parties?: Person["parties"];
  published?: unknown;
  deleted?: unknown;
  revision_id?: unknown;
};

/** The people the runs name, one round trip per 100. */
async function peopleById(
  db: FirebaseFirestore.Firestore,
  ids: Iterable<string>,
): Promise<Map<string, StoredNode>> {
  const list = Array.from(new Set(ids));
  const people = new Map<string, StoredNode>();
  for (let i = 0; i < list.length; i += 100) {
    const refs = list
      .slice(i, i + 100)
      .map((id) => db.collection("nodes").doc(id));
    for (const snap of await db.getAll(...refs)) {
      if (!snap.exists) continue;
      people.set(snap.id, {
        id: snap.id,
        ...(snap.data() as Omit<StoredNode, "id">),
      });
    }
  }
  return people;
}

function runOf(
  edge: Stored<Edge>,
  person: StoredNode,
  shown: Pick<RegionRun, "parties" | "partyHidden" | "published">,
): RegionRun {
  return {
    edgeId: edge.id,
    personId: person.id,
    // Never empty: a person with no name is on no list (`electionLists`).
    personName: person.name ?? "",
    ...shown,
    start: edge.start_date ?? null,
    position: edge.position ?? null,
    committee: edge.committee ?? null,
    party: edge.party ?? null,
    elected: edge.elected === true,
    byElection: edge.by_election === true,
  };
}

/** Who stood for election in a region, for its page to group into lists.
 *
 * A candidacy runs from the person to the place they stood in, so the region
 * page's own graph has these on the side it reads as „Część regionu” and has
 * never shown them. And the graph names only published people, where a list
 * is worth reading for the others on it: of the 4,880 published runs on
 * published pages on the 2026-11-11 export, 44% shared their list with no
 * other published person, and 12% once the unpublished are counted.
 *
 * So a logged out reader is told about unpublished candidates too, the way a
 * company's board tells them about its unpublished members (Szymon,
 * 2026-11-11: „yes”, to doing it as the boards do). The list is PKW's, which
 * names them; what stays behind the sign in is their party, which on an
 * unpublished person is a match nobody has checked. And only a person and a
 * run an import wrote or a reviewer approved (`importedOrReviewed`): a
 * candidacy somebody added by hand is their say-so about a named individual.
 *
 * A published person's run is shown once it is published itself, as on their
 * own page. An unpublished run of a published person is mostly a PKW match
 * nobody has looked at yet - the namesake candidacies the review lists keep
 * finding - and a published page is where the site stands behind a name.
 *
 * An editor reads everything, through the cache, as on the other routes.
 */
async function electionLists(event: H3Event): Promise<RegionRuns> {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Missing id" });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const showUnapproved = await wantsLatest(event);

  const regionSnap = await db.collection("nodes").doc(id).get();
  const region = regionSnap.data() as Omit<StoredNode, "id"> | undefined;
  // A page nobody may open has no lists to fill. The page itself reports
  // that; this only refuses to be the way around it.
  if (
    !region ||
    region.type !== "region" ||
    (!showUnapproved && !pageIsPublic(region))
  ) {
    return { runs: [], hidden: 0 };
  }

  const snap = await db
    .collection("edges")
    .where("target", "==", id)
    .where("type", "==", "election")
    .limit(RUNS_PER_REGION)
    .get();
  const edges = snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Edge) }))
    .filter((edge) => edge.deleted !== true && !!edge.source);
  const people = await peopleById(
    db,
    edges.map((edge) => edge.source),
  );

  const runs: RegionRun[] = [];
  const drafts: { edge: Stored<Edge>; person: StoredNode }[] = [];
  /** A published person's win of the newest local election that this reader
   * is not shown yet: the region page says the seat's result awaits a
   * check, rather than that nobody is known (Warszawa's prezydent on
   * 2026-11-11: his page is published, his 2024 run is not). */
  const hiddenWins: Stored<Edge>[] = [];
  const newest = newestLocalElection();
  let hidden = 0;
  for (const edge of edges) {
    const person = people.get(edge.source);
    // A removed page, a merged duplicate (`merge.ts` removes it) and anything
    // that is not a person stand on no list.
    if (!person?.name || person.type !== "person" || person.deleted === true) {
      continue;
    }
    if (showUnapproved) {
      runs.push(
        runOf(edge, person, {
          parties: asArray(person.parties),
          published: pageIsPublic(person),
        }),
      );
    } else if (pageIsPublic(person)) {
      if (edge.published === true) {
        runs.push(
          runOf(edge, person, {
            parties: asArray(person.parties),
            published: true,
          }),
        );
      } else {
        hidden += 1;
        if (
          edge.elected === true &&
          edge.position &&
          candidacyElection(
            edge.start_date,
            edge.position,
            edge.by_election,
          ) === newest
        ) {
          hiddenWins.push(edge);
        }
      }
    } else {
      drafts.push({ edge, person });
    }
  }

  const hiddenElected: Record<string, number> = {};
  if (drafts.length || hiddenWins.length) {
    const shown = await importedOrReviewed(db, [
      ...drafts.map(({ person }) => person),
      ...drafts.map(({ edge }) => edge),
      ...hiddenWins,
    ]);
    // Only a win an import wrote or a reviewer approved: a hand-made one can
    // neither show a mayor nor hold the seat as awaiting. Counted by person,
    // and not at all for somebody this reader is shown winning that office:
    // a hidden copy of a shown win is a second document, not a second
    // claimant - a merge keeps the duplicate page's copy beside the
    // survivor's (`merge.ts`), and the ingest writes its own beside a
    // hand-dated one (Andrzej Kleszcz's 2024 council run, 2026-11-11).
    // A count still, never whose: that would name the hidden run.
    const shownWinners = new Set(
      runs
        .filter(
          (run) =>
            run.elected &&
            candidacyElection(run.start, run.position, run.byElection) ===
              newest,
        )
        .map((run) => `${run.position}\u0000${run.personId}`),
    );
    const counted = new Set<string>();
    for (const edge of hiddenWins) {
      const claim = `${edge.position}\u0000${edge.source}`;
      if (
        !shown.has(edge.id) ||
        shownWinners.has(claim) ||
        counted.has(claim)
      ) {
        continue;
      }
      counted.add(claim);
      hiddenElected[edge.position!] = (hiddenElected[edge.position!] ?? 0) + 1;
    }
    for (const { edge, person } of drafts) {
      if (!shown.has(person.id) || !shown.has(edge.id)) {
        hidden += 1;
        continue;
      }
      runs.push(
        runOf(edge, person, {
          parties: [],
          published: false,
          ...(asArray(person.parties).length > 0 ? { partyHidden: true } : {}),
        }),
      );
    }
  }

  return {
    runs,
    hidden,
    ...(Object.keys(hiddenElected).length ? { hiddenElected } : {}),
  };
}

/** Six hours, the site default: a list from 2018 does not change, and an
 * editor who has just added a candidacy reads through the cache anyway. */
export default editorFreshCachedEventHandler(electionLists, {
  name: "election-lists",
});
