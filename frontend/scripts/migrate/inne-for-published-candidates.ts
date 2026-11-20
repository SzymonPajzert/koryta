import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { asArray, type Edge } from "../../shared/model";
import { partyFloor, showsCandidacyAndPaidPost } from "../../shared/partyFloor";
import { withoutInternalFields } from "../../server/utils/revisions";
import { reportRemaining } from "./remaining";

/**
 * Give „Inne” to the published pages that show a candidacy and a paid public
 * post and name no party (decision on 2026-11-18, `partyFloor` in
 * shared/partyFloor.ts).
 *
 * A KWW list names none of the site's parties, so a councillor elected on one
 * read as nobody's: 260 published pages on the 2026-11-18 export, Anna
 * Jedynak-Rykała's among them, 235 of them put up by the declarations
 * automation. That now files „Inne” as it puts a page up
 * (server/utils/declarationPublish.ts); this does it for the pages up already,
 * 244 of the 260.
 *
 * The other 16 have a list a person set (`partiesSource: "manual"`), empty in
 * each, which only a person changes - the night checks that
 * (`test_a_party_list_a_person_pinned_is_changed_only_by_a_person`). They are
 * listed and left alone.
 *
 * Each page gets a revision, approved as written, as the ingest files the
 * parties it learns on a live page; the node is updated in place rather than
 * written back whole, so nothing another writer set meanwhile is lost.
 *
 * Usage, against the running dev:prod-data emulator:
 *   npx tsx scripts/migrate/inne-for-published-candidates.ts            # dry run
 *   npx tsx scripts/migrate/inne-for-published-candidates.ts --commit
 * Against production:
 *   npx tsx scripts/migrate/inne-for-published-candidates.ts --prod
 *   npx tsx scripts/migrate/inne-for-published-candidates.ts --prod --commit
 */

const AUTHOR = "migration:inne-for-published-candidates";

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

async function main() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run - pass --commit to apply)"),
  );

  const people = await db
    .collection("nodes")
    .where("type", "==", "person")
    .where("published", "==", true)
    .get();
  // A removed or merged page is not a page, whatever its flag says.
  const live = people.docs.filter(
    (doc) => doc.get("deleted") !== true && !doc.get("merged_into"),
  );
  const withoutParty = live.filter(
    (doc) => asArray(doc.get("parties")).length === 0,
  );
  const open = withoutParty.filter((doc) => partyFloor(doc.data()) !== null);
  console.log(
    `${live.length} published person page(s), ${withoutParty.length} naming ` +
      `no party, ${withoutParty.length - open.length} of them set so by a person.`,
  );

  // Their relations, in one read of the fields the rule asks about rather
  // than a query per page, then the companies their jobs are at.
  const ids = new Set(withoutParty.map((doc) => doc.id));
  const edges = await db
    .collection("edges")
    .select("source", "target", "type", "name", "published", "deleted")
    .get();
  const relations = new Map<string, Edge[]>();
  for (const doc of edges.docs) {
    const edge = doc.data() as Edge;
    if (!ids.has(edge.source)) continue;
    relations.set(edge.source, [...(relations.get(edge.source) ?? []), edge]);
  }
  const companies = new Map<string, Record<string, unknown>>();
  const targets = [
    ...new Set(
      [...relations.values()]
        .flat()
        .filter((edge) => edge.type === "employed")
        .map((edge) => edge.target),
    ),
  ];
  for (let i = 0; i < targets.length; i += 300) {
    const snapshots = await db.getAll(
      ...targets.slice(i, i + 300).map((id) => db.collection("nodes").doc(id)),
    );
    for (const snapshot of snapshots) {
      if (snapshot.exists) companies.set(snapshot.id, snapshot.data() ?? {});
    }
  }

  const due = open.filter((doc) =>
    showsCandidacyAndPaidPost(relations.get(doc.id) ?? [], (id) =>
      companies.get(id),
    ),
  );
  const pinned = withoutParty.filter(
    (doc) =>
      partyFloor(doc.data()) === null &&
      showsCandidacyAndPaidPost(relations.get(doc.id) ?? [], (id) =>
        companies.get(id),
      ),
  );
  console.log(
    `${due.length} show a candidacy and a paid public post: ` +
      `${commit ? "giving" : "would give"} them „Inne”. ` +
      `${open.length - due.length} show less and are left alone.`,
  );
  for (const doc of due.slice(0, 10)) {
    console.log(`  ${doc.id}  ${doc.get("name")}`);
  }
  if (due.length > 10) console.log(`  ... and ${due.length - 10} more`);
  if (pinned.length > 0) {
    console.log(
      `${pinned.length} more would qualify but a person set their list; ` +
        `left for a person:`,
    );
    for (const doc of pinned) console.log(`  ${doc.id}  ${doc.get("name")}`);
  }

  if (commit) {
    let batch = db.batch();
    let pending = 0;
    for (const doc of due) {
      const data = doc.data();
      const parties = partyFloor(data)!;
      const now = Timestamp.now();
      const revisionRef = db.collection("revisions").doc();
      batch.set(revisionRef, {
        node_id: doc.id,
        collection: "nodes",
        data: { ...withoutInternalFields(data), parties },
        update_time: now,
        update_user: AUTHOR,
        update_automatic: true,
        status: "approved",
        review_user: AUTHOR,
        review_time: now,
      });
      batch.update(doc.ref, {
        parties,
        ...(data.revision_id ? { revision_id: revisionRef } : {}),
      });
      pending += 2;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) await batch.commit();
    console.log(`Gave „Inne” to ${due.length} page(s).`);
  } else {
    reportRemaining({ pages: due.length });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
