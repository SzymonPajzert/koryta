/** Read-only access to production Firestore, for agent tooling.
 *
 * Nothing on the dev box can read Firestore by default: `dev-workflow`, the
 * account both gcloud and GOOGLE_APPLICATION_CREDENTIALS use there, is refused
 * by it, which keeps a local build or a stray script from quietly running on
 * production data. Reads go through a second account instead,
 * `firestore-reader`, that holds `roles/datastore.viewer` and nothing else.
 * gcloud mints an hour-long token for it by impersonation, so there is no key
 * file to look after, and IAM refuses a write whatever the code here asks for.
 * The one-time grant is in frontend/README.md, "Agent tools".
 *
 * REST rather than firebase-admin, whose Firestore takes only a key file or
 * application default credentials - neither of which is this account. The
 * tools need two calls, `runQuery` and `batchGet`, both reads, and both take a
 * field mask. Every read here has to name its fields, so a field left off the
 * list is never sent by Firestore at all.
 *
 * With FIRESTORE_EMULATOR_HOST set it reads that emulator instead, as the
 * emulator's `owner`.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const PROJECT = "koryta-pl";
/** The app's data is in the named database, not `(default)`. */
const DATABASE = "koryta-pl";
const DOCUMENTS = `projects/${PROJECT}/databases/${DATABASE}/documents`;

export const DEFAULT_READER = `firestore-reader@${PROJECT}.iam.gserviceaccount.com`;

const SETUP_HINT =
  'The one-time grant is in frontend/README.md, "Agent tools".';

/** A value as the REST API spells it: exactly one of these is set. */
export type RestValue = {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number | string;
  timestampValue?: string;
  stringValue?: string;
  bytesValue?: string;
  referenceValue?: string;
  geoPointValue?: { latitude: number; longitude: number };
  arrayValue?: { values?: RestValue[] };
  mapValue?: { fields?: Record<string, RestValue> };
};

type RestDocument = { name: string; fields?: Record<string, RestValue> };

export type Doc = { id: string; data: Record<string, unknown> };

/** Plain JS for a REST value. Integers become numbers - a `queueRank` can be
 * stored either way - and timestamps stay the ISO strings the API sends. */
export function decodeValue(value: RestValue): unknown {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.mapValue !== undefined) return decodeFields(value.mapValue.fields);
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values ?? []).map(decodeValue);
  }
  if (value.referenceValue !== undefined) return value.referenceValue;
  if (value.geoPointValue !== undefined) return value.geoPointValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  return null;
}

export const decodeFields = (
  fields: Record<string, RestValue> = {},
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );

const toDoc = (doc: RestDocument): Doc => ({
  id: doc.name.slice(doc.name.lastIndexOf("/") + 1),
  data: decodeFields(doc.fields),
});

export type ReadQuery = {
  collection: string;
  /** The only fields Firestore sends back. Required, so that nothing reads a
   * whole document by leaving it out. */
  fields: readonly string[];
  /** `field in values` - Firestore takes at most 30. */
  where?: { field: string; in: readonly string[] };
  orderBy?: { field: string; descending?: boolean };
  limit?: number;
};

export type FirestoreReader = {
  /** Where the reads go, for the answers to say: a list read off the
   * emulator must not pass for production. */
  source: string;
  query(query: ReadQuery): Promise<Doc[]>;
  /** Those of `ids` that exist, in no particular order. */
  get(
    collection: string,
    ids: readonly string[],
    fields: readonly string[],
  ): Promise<Doc[]>;
};

export function structuredQuery(query: ReadQuery) {
  return {
    from: [{ collectionId: query.collection }],
    select: { fields: query.fields.map((fieldPath) => ({ fieldPath })) },
    ...(query.where && {
      where: {
        fieldFilter: {
          field: { fieldPath: query.where.field },
          op: "IN",
          value: {
            arrayValue: {
              values: query.where.in.map((stringValue) => ({ stringValue })),
            },
          },
        },
      },
    }),
    ...(query.orderBy && {
      orderBy: [
        {
          field: { fieldPath: query.orderBy.field },
          direction: query.orderBy.descending ? "DESCENDING" : "ASCENDING",
        },
      ],
    }),
    ...(query.limit !== undefined && { limit: query.limit }),
  };
}

/** Firestore's own message for a failed call, with what to do about a 403. */
function failure(status: number, body: string, source: string): Error {
  let message = body.trim();
  try {
    const parsed = JSON.parse(body);
    message =
      (Array.isArray(parsed) ? parsed[0] : parsed)?.error?.message ?? message;
  } catch {
    // Not JSON - keep the body as it came.
  }
  const hint =
    status === 403 ? ` ${source} has no read access yet. ${SETUP_HINT}` : "";
  return new Error(`Firestore answered ${status}: ${message}.${hint}`);
}

export function restReader(options: {
  /** `https://firestore.googleapis.com`, or the emulator's `http://host:port`. */
  origin: string;
  token: () => Promise<string>;
  source: string;
  fetch?: typeof fetch;
}): FirestoreReader {
  const send = options.fetch ?? fetch;

  async function call<T>(method: "runQuery" | "batchGet", body: unknown) {
    const response = await send(`${options.origin}/v1/${DOCUMENTS}:${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await options.token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw failure(response.status, await response.text(), options.source);
    }
    return (await response.json()) as T;
  }

  return {
    source: options.source,

    async query(query) {
      const rows = await call<{ document?: RestDocument }[]>("runQuery", {
        structuredQuery: structuredQuery(query),
      });
      return rows.flatMap((row) => (row.document ? [toDoc(row.document)] : []));
    },

    async get(collection, ids, fields) {
      if (ids.length === 0) return [];
      // An id is one path segment. Anything else would name a document in
      // some other collection.
      const bad = ids.find((id) => !/^[^/]+$/.test(id));
      if (bad !== undefined) throw new Error(`Not a document id: "${bad}"`);
      const rows = await call<{ found?: RestDocument }[]>("batchGet", {
        documents: ids.map((id) => `${DOCUMENTS}/${collection}/${id}`),
        mask: { fieldPaths: fields },
      });
      return rows.flatMap((row) => (row.found ? [toDoc(row.found)] : []));
    },
  };
}

type Run = (
  file: string,
  args: readonly string[],
  options: { timeout: number },
) => Promise<{ stdout: string }>;

/** A token for `account`, minted by whoever gcloud is logged in as. Kept for
 * 45 minutes of the hour it is good for, since gcloud takes a second. */
export function impersonatedToken(
  account: string,
  run: Run = promisify(execFile),
): () => Promise<string> {
  let cached: { token: string; until: number } | undefined;
  return async () => {
    if (cached && Date.now() < cached.until) return cached.token;
    try {
      const { stdout } = await run(
        "gcloud",
        [
          "auth",
          "print-access-token",
          `--impersonate-service-account=${account}`,
          "--quiet",
        ],
        { timeout: 60_000 },
      );
      cached = { token: stdout.trim(), until: Date.now() + 45 * 60_000 };
      return cached.token;
    } catch (error) {
      // gcloud warns about impersonation even when it works, so the reason
      // for a failure is the ERROR line, not the first thing on stderr.
      const stderr = String((error as { stderr?: string }).stderr ?? error);
      const reason =
        stderr.split("\n").find((line) => line.startsWith("ERROR:")) ??
        stderr.trim();
      throw new Error(
        `gcloud could not act as ${account}: ${reason} ${SETUP_HINT}`,
        { cause: error },
      );
    }
  };
}

export function connect(env: NodeJS.ProcessEnv = process.env): FirestoreReader {
  const emulator = env.FIRESTORE_EMULATOR_HOST;
  if (emulator) {
    return restReader({
      origin: `http://${emulator}`,
      token: async () => "owner",
      source: `the Firestore emulator at ${emulator}`,
    });
  }
  const account = env.KORYTA_FIRESTORE_READER || DEFAULT_READER;
  return restReader({
    origin: "https://firestore.googleapis.com",
    token: impersonatedToken(account),
    source: `production (${PROJECT}/${DATABASE}) as ${account}`,
  });
}
