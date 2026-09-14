import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { contractSources } from "~~/shared/contracts";

/** The aggregates behind every number this feature prints.
 *
 * Two documents, written by the pipeline after it has finished shipping
 * contracts: one `contractStats/{nodeId}` per touched company, and one
 * `stats/umowy` describing the window as a whole.
 *
 * They are precomputed because the alternative is a `count()` on a collection
 * of 149 683 documents - about 150 billed reads per uncached call, on a route
 * behind a 60 second cache - and because /instytucja/ pages draw 42% of the
 * site's search impressions and the section has to cost one read on the 4 103
 * companies that have no contracts at all.
 *
 * Neither document carries any person data. That is what makes denormalising
 * them safe where a people aggregate would not be: unpublishing somebody has
 * to take effect at once, and nothing in this repo can purge the CDN copy of a
 * response a name was baked into.
 */

const companySchema = z.object({
  nodeId: z.string().min(1),
  buyerCount: z.number().int().min(0),
  buyerValue: z.number().min(0),
  supplierCount: z.number().int().min(0),
  supplierValue: z.number().min(0),
  totalCount: z.number().int().min(0),
  totalValue: z.number().min(0),
  /** Required, not optional. The distribution is median 1 436 zł against a
   * maximum of 1 105 491 462, so the sum is never printed without it, and a
   * missing median would make the UI print the sum alone. */
  medianValue: z.number().min(0),
  lastSignedAt: z.string().optional(),
  computedAt: z.string().min(1),
});

const coverageSchema = z.object({
  total: z.number().int().min(0),
  stored: z.number().int().min(0),
  linked: z.number().int().min(0),
  bothLinked: z.number().int().min(0),
  companies: z.number().int().min(0),
  namedPeople: z.number().int().min(0),
  withIndividual: z.number().int().min(0),
  registerInstitutions: z.number().int().min(0),
  from: z.string().min(1),
  to: z.string().min(1),
  computedAt: z.string().min(1),
  sources: z.array(z.enum(contractSources)).nonempty(),
});

const requestSchema = z.object({
  companies: z.array(companySchema).max(500),
  coverage: coverageSchema.optional(),
  /** The last batch of the run. Triggers the count check below and the
   * `stats/umowy` write. */
  final: z.boolean().default(false),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    requestSchema.parse(body),
  );
  requireDatascience(await getUser(event));

  const db = getFirestore(getApp(), "koryta-pl");

  const writer = db.bulkWriter();
  for (const company of body.companies) {
    writer.set(db.collection("contractStats").doc(company.nodeId), company);
  }
  await writer.close();

  if (!body.final) {
    return { companies: body.companies.length, coverage: false };
  }

  if (!body.coverage) {
    throw createError({
      statusCode: 400,
      message: "final=true requires a coverage document",
    });
  }

  // One `count()` over the collection, once per pipeline run - about 150
  // billed reads, and the only place in this feature allowed to spend them.
  //
  // On this feature the numbers ARE the editorial product: every headline,
  // every caption and the whole „Skąd te dane" note are interpolated from this
  // document, and no server-side code downstream can contradict it. A run that
  // shipped 9 000 contracts and then advertised 13 333 would print a coverage
  // claim nothing could catch. So the aggregate is checked against the
  // collection it describes before it is allowed to become the site's copy.
  const stored = (await db.collection("contracts").count().get()).data().count;
  if (stored !== body.coverage.stored) {
    throw createError({
      statusCode: 409,
      message:
        `stats/umowy claims ${body.coverage.stored} stored contracts, ` +
        `the collection holds ${stored}. Refusing to publish the coverage ` +
        `document; re-run the ingest and submit the summary again.`,
    });
  }

  // Written last, and only once everything it describes is in place: a partial
  // run must never advertise a `computedAt` its aggregates do not have.
  await db.collection("stats").doc("umowy").set(body.coverage);

  return { companies: body.companies.length, coverage: true, stored };
});
