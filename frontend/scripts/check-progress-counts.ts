/** Does the aggregation path in /api/stats/progress agree with the scan, run
 * against a real Firestore?
 *
 * `tests/server/utils/progressStats.test.ts` proves the arithmetic, and it
 * cannot prove the queries: it feeds `combineProgressCounts` numbers a helper
 * computed in JavaScript, so a predicate that asks Firestore for the wrong
 * thing - and gets an answer - passes it. This does the same comparison with
 * the counts coming out of the database, so the predicates themselves are what
 * is under test. Keep the two sides in step with `countProgress`.
 *
 * `npm run check:progress-counts` (under `devns`, which the emulator's ports
 * need). Does not prove the composite indexes exist: the emulator invents any
 * index a query asks for, so only a deploy tells you that. */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  combineProgressCounts,
  scanProgress,
} from "../server/utils/progressStats";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
initializeApp({ projectId: "demo-koryta-pl" });
const db = getFirestore();

const population = [
  { type: "person", stats: { isApproved: true } },
  { type: "person", stats: { isApproved: true, votes: { humanVoted: true } } },
  { type: "person", stats: { isApproved: true, notesCount: 2 } },
  { type: "person", stats: { votes: { humanVoted: true } } },
  { type: "person", stats: { votes: { humanVoted: true }, notesCount: 3 } },
  { type: "person", stats: { notesCount: 1 } },
  { type: "person", stats: { notesCount: 0 } },
  { type: "person", stats: { isApproved: false } },
  { type: "person", stats: {} },
  { type: "person", stats: { votes: { humanVoted: false } } },
  // Not a person: must not be counted at all.
  { type: "place", stats: { isApproved: true, notesCount: 5 } },
];

const batch = db.batch();
population.forEach((doc, i) =>
  batch.set(db.collection("nodes").doc(`n${i}`), doc),
);
await batch.commit();

const people = db.collection("nodes").where("type", "==", "person");
const [total, approved, voted, votedApproved, noted, all] = await Promise.all([
  people.count().get(),
  people.where("stats.isApproved", "==", true).count().get(),
  people.where("stats.votes.humanVoted", "==", true).count().get(),
  people
    .where("stats.votes.humanVoted", "==", true)
    .where("stats.isApproved", "==", true)
    .count()
    .get(),
  people
    .where("stats.notesCount", ">", 0)
    .select("stats.isApproved", "stats.votes.humanVoted")
    .get(),
  people.get(),
]);

const counted = combineProgressCounts({
  total: total.data().count,
  approved: approved.data().count,
  voted: voted.data().count,
  votedAndApproved: votedApproved.data().count,
  noted: noted.docs.map((d) => ({
    isApproved: d.get("stats.isApproved") === true,
    humanVoted: d.get("stats.votes.humanVoted") === true,
  })),
});
const scanned = scanProgress(all.docs.map((d) => d.data()));

console.log("counted:", JSON.stringify(counted));
console.log("scanned:", JSON.stringify(scanned));
if (JSON.stringify(counted) !== JSON.stringify(scanned)) {
  console.error("MISMATCH");
  process.exit(1);
}
console.log("OK - the two agree against a real Firestore");
