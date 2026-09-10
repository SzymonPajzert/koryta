import { getFirestore, type Query } from "firebase-admin/firestore";
import {
  bucketNotes,
  bucketPeople,
  bucketPlaces,
  bucketPublicationCandidates,
  bucketVotes,
  type NotesBreakdown,
  type PeopleBreakdown,
  type PlacesBreakdown,
  type PublicationBucket,
  type VotesBreakdown,
} from "~~/server/utils/databaseStats";
import { isPipelineUid } from "~~/server/utils/activityStats";
import type { NoteSource, VoteDocument } from "~~/shared/model";

export type DatabaseStats = {
  /** When the numbers were computed, so a cached page can say how fresh it is. */
  generatedAt: string;
  nodes: {
    total: number;
    people: number;
    places: number;
    articles: number;
    regions: number;
  };
  people: PeopleBreakdown;
  /** Positively rated people, by score and by whether they are published yet. */
  publicationCandidates: PublicationBucket[];
  places: PlacesBreakdown;
  /** Connections in the graph: employment, party membership, mentions. */
  edges: number;
  notes: NotesBreakdown;
  revisions: {
    total: number;
    /** Nodes whose latest revision is not the approved one. */
    unapprovedNodes: number;
  };
  votes: VotesBreakdown;
  extractions: {
    total: number;
    /** Facts a human has already ruled on. */
    reviewed: number;
  };
  comments: number;
};

/** The state of the database in one response: how much is in it, how much of it
 * anybody has checked, and how the community's verdicts are distributed.
 *
 * Nothing here depends on who is asking and nothing here names a person, so the
 * whole thing is computed once and shared. That matters: the breakdowns need
 * every person, every note and every vote read, which is not a per-page-view
 * cost. The page it feeds used to stream the entire `votes` collection - uids
 * included - into the browser and count it there.
 */
export default defineCachedEventHandler(
  async (): Promise<DatabaseStats> => {
    const db = getFirestore("koryta-pl");
    const nodes = db.collection("nodes");

    const [
      peopleSnap,
      placesSnap,
      articleCount,
      regionCount,
      edgeCount,
      notesSnap,
      revisionCount,
      unapprovedCount,
      votesSnap,
      extractionCount,
      reviewedExtractionCount,
      commentCount,
    ] = await Promise.all([
      nodes
        .where("type", "==", "person")
        .select(
          "stats.isApproved",
          "stats.votes.humanVoted",
          "stats.notesCount",
          "stats.edges.all.experienceMonths",
          "stats.edges.all.currentlyEmployed",
          "stats.votes.interesting",
        )
        .get(),
      nodes
        .where("type", "==", "place")
        .select("isPublic", "isPublicSource")
        .get(),
      count(nodes.where("type", "==", "article")),
      count(nodes.where("type", "==", "region")),
      count(db.collection("edges")),
      db.collection("notes").select("sources", "nodeId").get(),
      count(db.collection("revisions")),
      count(nodes.where("revisions.has_unapproved", "==", true)),
      db
        .collection("votes")
        .select("categoryVotes", "userUid", "nodeId", "extractionId", "comment")
        .get(),
      count(db.collection("extractions")),
      count(
        db
          .collection("extractions")
          .where("stats.votes.humanVoted", "==", true),
      ),
      count(db.collection("comments")),
    ]);

    const peopleRows = peopleSnap.docs.map((doc) => ({
      isApproved: doc.get("stats.isApproved"),
      humanVoted: doc.get("stats.votes.humanVoted"),
      notesCount: doc.get("stats.notesCount"),
      experienceMonths: doc.get("stats.edges.all.experienceMonths"),
      currentlyEmployed: doc.get("stats.edges.all.currentlyEmployed"),
      interesting: doc.get("stats.votes.interesting"),
    }));
    const people = bucketPeople(peopleRows);

    const places = bucketPlaces(
      placesSnap.docs.map((doc) => ({
        isPublic: doc.get("isPublic"),
        isPublicSource: doc.get("isPublicSource"),
      })),
    );

    const notes = bucketNotes(
      notesSnap.docs.map((doc) => ({
        nodeId: doc.get("nodeId") as string | undefined,
        sources: doc.get("sources") as NoteSource[] | undefined,
      })),
    );

    const votes = bucketVotes(
      votesSnap.docs.map((doc) => doc.data() as VoteDocument),
      isPipelineUid,
    );

    return {
      generatedAt: new Date().toISOString(),
      nodes: {
        total: people.total + places.total + articleCount + regionCount,
        people: people.total,
        places: places.total,
        articles: articleCount,
        regions: regionCount,
      },
      people,
      publicationCandidates: bucketPublicationCandidates(peopleRows),
      places,
      edges: edgeCount,
      notes,
      revisions: { total: revisionCount, unapprovedNodes: unapprovedCount },
      votes,
      extractions: {
        total: extractionCount,
        reviewed: reviewedExtractionCount,
      },
      comments: commentCount,
    };
  },
  // Six hours, up from ten minutes. This is a census of the whole database -
  // every person, every note, every vote read - and it was 325,248 Firestore
  // reads in 28 hours across 106 calls, 16% of everything the site read. The
  // page it feeds is a snapshot of a corpus that a day's crawling moves by
  // fractions of a percent, and `generatedAt` is in the response precisely so
  // that it can say how old the numbers are. Nobody is waiting on this the way
  // they wait on a page they just edited.
  { name: "stats-database", maxAge: 21600, swr: true },
);

async function count(query: Query): Promise<number> {
  return (await query.count().get()).data().count;
}
