import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { Edge } from "../shared/model";
import {
  postIsPaid,
  unpaidSeatsByPlace,
  type SeatPay,
} from "../shared/companyBodies";
import { computeEdgeStats } from "../shared/stats";

/**
 * What this branch actually put on a local stack.
 *
 * Read-only. Run it against the emulator after the seat migration, the region
 * nodes and the company ingest, to check the four things that are easy to get
 * silently wrong: the seat split left every company exactly one seat, the
 * register's owners landed as `owns` edges, the categories moved, and the
 * hospitals' rada społeczna stopped counting as employment.
 *
 *   npx tsx scripts/verify-local.ts
 *
 * The last section needs `/api/stats/computeNodes` to have run since the
 * company ingest - that is what writes the counters this compares against.
 */

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "koryta-pl";

const app = initializeApp({ projectId: "koryta-pl" });

/** Companies whose ownership the register states plainly, so a wrong answer
 * here is a wrong answer and not a judgement call. */
const CHECKS: { krs: string; name: string; expect: string }[] = [
  {
    krs: "0000076705",
    name: "PKP SKM w Trójmieście",
    expect: "PKP S.A. + Gmina Miasta Gdańsk + Woj. Pomorskie; seat Gdynia",
  },
  { krs: "0000109022", name: "Sądeckie Wodociągi", expect: "4 owner gminy" },
  { krs: "0000094136", name: "Żywiec water company", expect: "16 owner gminy" },
];

async function main() {
  const db = getFirestore(app, "koryta-pl");

  const nodes = await db.collection("nodes").get();
  const byId = new Map(nodes.docs.map((d) => [d.id, d.data()]));
  const places = nodes.docs.filter((d) => d.data().type === "place");
  const regions = nodes.docs.filter((d) => d.data().type === "region");
  console.info(`nodes: ${places.length} places, ${regions.length} regions`);

  const edges = await db.collection("edges").get();
  const seats = new Map<string, string[]>();
  const owners = new Map<string, string[]>();
  let regionToRegion = 0;
  for (const doc of edges.docs) {
    const e = doc.data();
    const s = byId.get(e.source)?.type;
    const t = byId.get(e.target)?.type;
    if (e.type === "seat" && t === "place") {
      seats.set(e.target, [...(seats.get(e.target) ?? []), e.source]);
    } else if (e.type === "owns" && t === "place") {
      owners.set(e.target, [...(owners.get(e.target) ?? []), e.source]);
    } else if (e.type === "owns" && s === "region" && t === "region") {
      regionToRegion += 1;
    }
  }

  const strayOwnsSeat = edges.docs.filter((d) => {
    const e = d.data();
    return (
      e.type === "owns" &&
      byId.get(e.source)?.type === "region" &&
      byId.get(e.target)?.type === "place"
    );
  }).length;

  console.info(`\nedges`);
  console.info(`  seat  region->place : ${[...seats.values()].flat().length}`);
  console.info(`  owns  ->place       : ${[...owners.values()].flat().length}`);
  console.info(`    of which region-> : ${strayOwnsSeat}   (JST shareholders)`);
  console.info(
    `  owns  region->region: ${regionToRegion}   (hierarchy, untouched)`,
  );
  // 66 companies arrive with two seat documents already - 65 exact duplicate
  // pairs from before edge ids were derived from (source, target, type), plus
  // Koleje Śląskie claimed by both teryt24 and teryt2469. Anything past that is
  // the ingest resolving a seat to a region the stored one did not come from,
  // which is worth naming rather than counting.
  const multiSeat = [...seats.entries()].filter(([, v]) => v.length > 1);
  const twoDistinct = multiSeat.filter(([, v]) => new Set(v).size > 1);
  console.info(`  companies with >1 seat: ${multiSeat.length}`);
  console.info(`    of which two DIFFERENT regions: ${twoDistinct.length}`);
  for (const [placeId, regionIds] of twoDistinct.slice(0, 20)) {
    const place = byId.get(placeId);
    console.info(
      `      ${place?.krsNumber ?? placeId} ${String(place?.name).slice(0, 40)}: ` +
        `${[...new Set(regionIds)].map((r) => byId.get(r)?.name ?? r).join(" + ")}`,
    );
  }
  console.info(`  companies with an owner: ${owners.size}`);

  const cats = new Map<string, number>();
  for (const d of places) {
    const raw = d.data().categories;
    const list = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];
    for (const c of list as string[]) cats.set(c, (cats.get(c) ?? 0) + 1);
  }
  console.info(`\ncategories`);
  for (const [c, n] of [...cats].sort((a, b) => b[1] - a[1])) {
    console.info(`  ${c.padEnd(22)} ${n}`);
  }
  const uncategorised = places.filter((d) => {
    const raw = d.data().categories;
    const list = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];
    return list.length === 0;
  }).length;
  console.info(`  ${"(none)".padEnd(22)} ${uncategorised}`);

  // Supervisory organs and unpaid seats, and whether the counters honour them.
  // See `shared/companyBodies.ts` - a rada społeczna seat is unpaid, so it is
  // not employment, and the whole point is that nothing about the stored edge
  // says so: every one of them is named "Rada Nadzorcza". A place whose
  // statute pays nobody (`paidSeats: false`) has every post dropped.
  const unpaidSeats = unpaidSeatsByPlace(
    places.map((d) => [d.id, d.data() as SeatPay] as const),
  );
  const publicPlaceIds = new Set(
    places.filter((d) => d.data().isPublic === true).map((d) => d.id),
  );
  const bodies = new Map<string, number>();
  for (const d of places) {
    const body = d.data().supervisoryBody;
    if (body) bodies.set(body, (bodies.get(body) ?? 0) + 1);
  }
  console.info(`\nsupervisory organs`);
  if (bodies.size === 0) {
    console.info(
      "  (none stored - the company ingest has not run, or ran without `form`)",
    );
  }
  for (const [body, n] of [...bodies].sort((a, b) => b[1] - a[1])) {
    console.info(`  ${body.padEnd(22)} ${n}`);
  }

  const employment = edges.docs
    .map((d) => d.data() as Edge)
    .filter((e) => e.type === "employed");
  const atUnpaid = employment.filter((e) => unpaidSeats.has(e.target));
  const dropped = atUnpaid.filter(
    (e) => !postIsPaid(e.name, unpaidSeats.get(e.target)),
  );
  const kept = atUnpaid.filter((e) =>
    postIsPaid(e.name, unpaidSeats.get(e.target)),
  );
  console.info(`  employment edges at those places: ${atUnpaid.length}`);
  console.info(`    dropped (an unpaid seat)      : ${dropped.length}`);
  console.info(
    `    kept (a real post)            : ${kept.length}` +
      (kept.length
        ? `   ${[...new Set(kept.map((e) => e.name ?? "(unnamed)"))].join(", ")}`
        : ""),
  );
  console.info(
    `    people holding a dropped seat : ${new Set(dropped.map((e) => e.source)).size}`,
  );

  // Does the *stored* counter agree with what the code would compute now? This
  // is what says `/api/stats/computeNodes` has run since the ingest - without
  // it every number above can be right and the table still sorts on the old
  // one. `experienceMonths` is deliberately not compared: an open-ended spell
  // measures to `new Date()`, so it moves between the stats run and this one.
  const bySource = new Map<string, Edge[]>();
  for (const doc of edges.docs) {
    const e = doc.data() as Edge;
    if (!e.source) continue;
    bySource.set(e.source, [...(bySource.get(e.source) ?? []), e]);
  }
  let checked = 0;
  const stale: string[] = [];
  for (const doc of nodes.docs) {
    const node = doc.data();
    if (node.type !== "person") continue;
    const own = bySource.get(doc.id);
    if (!own?.some((e) => e.type === "employed")) continue;
    checked += 1;
    const expected = computeEdgeStats(own, publicPlaceIds, {}, unpaidSeats);
    const stored = node.stats?.edges?.all;
    if (
      (stored?.latestEmploymentStart ?? null) !==
        expected.all.latestEmploymentStart ||
      (stored?.currentlyEmployed ?? false) !== expected.all.currentlyEmployed
    ) {
      stale.push(
        `${String(node.name).slice(0, 32)}: stored ${stored?.latestEmploymentStart ?? "null"}` +
          `, expected ${expected.all.latestEmploymentStart ?? "null"}`,
      );
    }
  }
  console.info(`  people whose counters were checked: ${checked}`);
  console.info(
    `    disagreeing with the code       : ${stale.length}` +
      (stale.length ? "   <- run /api/stats/computeNodes" : "   (all current)"),
  );
  for (const line of stale.slice(0, 10)) console.info(`      ${line}`);

  console.info(`\nnamed companies`);
  for (const check of CHECKS) {
    const node = places.find((d) => d.data().krsNumber === check.krs);
    if (!node) {
      console.info(`  ${check.krs} ${check.name}: NOT ON THE SITE`);
      continue;
    }
    const seatIds = seats.get(node.id) ?? [];
    const ownerIds = owners.get(node.id) ?? [];
    const nameOf = (id: string) => byId.get(id)?.name ?? id;
    console.info(`  ${check.krs} ${check.name}`);
    console.info(`    expected : ${check.expect}`);
    console.info(
      `    seat     : ${seatIds.map(nameOf).join(", ") || "(none)"}`,
    );
    console.info(
      `    owners   : ${ownerIds.map(nameOf).join(", ") || "(none)"}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
