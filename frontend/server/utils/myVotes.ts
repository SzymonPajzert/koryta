import type { Firestore } from "firebase-admin/firestore";
import { generateEntityUrl } from "~~/shared/slugs";
import { nodeTypes, type NodeType } from "~~/shared/model";

/** How many of one user's votes are read. The most votes on people any account
 * had on 2026-11-20 was 746, and the median voter 3. */
export const VOTES_SCAN_CAP = 1000;

/** A vote on a person, as /profil lists it: who, and what was said about
 * them in the „interesting” category. */
export type MyVote = {
  nodeId: string;
  /** Null once the page is gone. */
  name: string | null;
  /** The page to open, or null when there is none to link to. */
  path: string | null;
  value: number;
  updatedAt: string;
};

export type ScannedVote = Pick<MyVote, "nodeId" | "value" | "updatedAt">;

/**
 * The pages one user voted on in the „interesting” category, newest vote
 * first.
 *
 * One query on the composite index `(userUid, updatedAt desc, nodeId)`. Its
 * order on `nodeId` keeps out the votes on extracted facts, which carry an
 * `extractionId` instead: a document without the field is not in the index.
 * A vote taken back is stored as zero, so it is not a vote.
 */
export async function scanMyVotes(
  db: Firestore,
  uid: string,
): Promise<{ votes: ScannedVote[]; truncated: boolean }> {
  const snapshot = await db
    .collection("votes")
    .where("userUid", "==", uid)
    .orderBy("updatedAt", "desc")
    .orderBy("nodeId")
    .select("nodeId", "categoryVotes", "updatedAt")
    .limit(VOTES_SCAN_CAP)
    .get();

  const votes = snapshot.docs.flatMap((doc) => {
    const nodeId = doc.get("nodeId");
    const updatedAt = doc.get("updatedAt");
    const value = doc.get("categoryVotes")?.interesting;
    return typeof nodeId === "string" &&
      typeof updatedAt === "string" &&
      typeof value === "number" &&
      value !== 0
      ? [{ nodeId, updatedAt, value }]
      : [];
  });
  return { votes, truncated: snapshot.size >= VOTES_SCAN_CAP };
}

/** The names and pages of the people voted on, read for the rows a page
 * shows rather than for every vote scanned. */
export async function nameVotes(
  db: Firestore,
  votes: ScannedVote[],
): Promise<MyVote[]> {
  const ids = [...new Set(votes.map((vote) => vote.nodeId))];
  const snapshots =
    ids.length > 0
      ? await db.getAll(...ids.map((id) => db.collection("nodes").doc(id)), {
          fieldMask: ["name", "type"],
        })
      : [];
  const pages = new Map(ids.map((id, index) => [id, snapshots[index]]));

  return votes.map((vote) => {
    const page = pages.get(vote.nodeId);
    const name = page?.exists ? stringOrNull(page.get("name")) : null;
    const type = page?.exists ? nodeTypeOrNull(page.get("type")) : null;
    return {
      ...vote,
      name,
      path: type && name ? generateEntityUrl(type, vote.nodeId, name) : null,
    };
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nodeTypeOrNull(value: unknown): NodeType | null {
  return typeof value === "string" &&
    (nodeTypes as readonly string[]).includes(value)
    ? (value as NodeType)
    : null;
}
