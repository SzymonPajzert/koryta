// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  connect,
  decodeValue,
  impersonatedToken,
  restReader,
} from "../../scripts/mcp/firestore-reader";

const DOCUMENTS = "projects/koryta-pl/databases/koryta-pl/documents";

/** A fetch that records what was asked and answers with `reply`. */
function fakeFetch(reply: () => { status?: number; json: unknown }) {
  const calls: { url: string; body: unknown; auth: string }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const headers = init.headers as Record<string, string>;
    calls.push({ url, body, auth: headers.Authorization! });
    const { status = 200, json } = reply();
    return new Response(JSON.stringify(json), { status });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const reader = (fetch: typeof globalThis.fetch) =>
  restReader({
    origin: "https://firestore.test",
    token: async () => "t0k3n",
    source: "the test database",
    fetch,
  });

describe("decodeValue", () => {
  it("turns REST values into plain ones", () => {
    expect(
      decodeValue({
        mapValue: {
          fields: {
            rank: { integerValue: "1024" },
            half: { doubleValue: 1536.5 },
            at: { timestampValue: "2026-09-24T10:11:12.345Z" },
            none: { nullValue: null },
            list: {
              arrayValue: {
                values: [{ stringValue: "a" }, { booleanValue: false }],
              },
            },
            empty: { arrayValue: {} },
            nested: { mapValue: {} },
          },
        },
      }),
    ).toEqual({
      rank: 1024,
      half: 1536.5,
      at: "2026-09-24T10:11:12.345Z",
      none: null,
      list: ["a", false],
      empty: [],
      nested: {},
    });
  });
});

describe("restReader", () => {
  it("asks for the named fields only, and returns documents by id", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      json: [
        {
          document: {
            name: `${DOCUMENTS}/feedback/abc`,
            fields: { kind: { stringValue: "bug" } },
          },
        },
        // runQuery ends with a row that holds no document.
        { readTime: "2026-09-26T00:00:00Z" },
      ],
    }));

    const docs = await reader(fetch).query({
      collection: "feedback",
      fields: ["kind", "context.route"],
      where: { field: "adminStatus", in: ["new", "in_progress"] },
      orderBy: { field: "createdAt", descending: true },
      limit: 5,
    });

    expect(docs).toEqual([{ id: "abc", data: { kind: "bug" } }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      `https://firestore.test/v1/${DOCUMENTS}:runQuery`,
    );
    expect(calls[0]!.auth).toBe("Bearer t0k3n");
    expect(calls[0]!.body).toEqual({
      structuredQuery: {
        from: [{ collectionId: "feedback" }],
        select: {
          fields: [{ fieldPath: "kind" }, { fieldPath: "context.route" }],
        },
        where: {
          fieldFilter: {
            field: { fieldPath: "adminStatus" },
            op: "IN",
            value: {
              arrayValue: {
                values: [
                  { stringValue: "new" },
                  { stringValue: "in_progress" },
                ],
              },
            },
          },
        },
        orderBy: [
          { field: { fieldPath: "createdAt" }, direction: "DESCENDING" },
        ],
        limit: 5,
      },
    });
  });

  it("gets documents by id through a field mask, skipping missing ones", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      json: [
        { missing: `${DOCUMENTS}/feedback/gone` },
        {
          found: {
            name: `${DOCUMENTS}/feedback/here`,
            fields: { message: { stringValue: "hi" } },
          },
        },
      ],
    }));

    const docs = await reader(fetch).get(
      "feedback",
      ["gone", "here"],
      ["message"],
    );

    expect(docs).toEqual([{ id: "here", data: { message: "hi" } }]);
    expect(calls[0]!.url).toBe(
      `https://firestore.test/v1/${DOCUMENTS}:batchGet`,
    );
    expect(calls[0]!.body).toEqual({
      documents: [`${DOCUMENTS}/feedback/gone`, `${DOCUMENTS}/feedback/here`],
      mask: { fieldPaths: ["message"] },
    });
  });

  it("refuses an id that would reach into another collection", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: [] }));
    await expect(
      reader(fetch).get("feedback", ["../users/someone"], ["message"]),
    ).rejects.toThrow("Not a document id");
    expect(calls).toHaveLength(0);
  });

  it("does not call Firestore for no ids", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: [] }));
    expect(await reader(fetch).get("feedback", [], ["message"])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("says what to do when the account has no access", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 403,
      json: [
        {
          error: {
            code: 403,
            message: "Missing or insufficient permissions.",
            status: "PERMISSION_DENIED",
          },
        },
      ],
    }));
    await expect(
      reader(fetch).query({ collection: "feedback", fields: ["kind"] }),
    ).rejects.toThrow(
      /403: Missing or insufficient permissions\..*the test database has no read access yet.*frontend\/README\.md/,
    );
  });
});

describe("impersonatedToken", () => {
  it("asks gcloud for a token as the reader, once an hour", async () => {
    const run = vi.fn(async () => ({ stdout: "ya29.token\n" }));
    const token = impersonatedToken(
      "reader@koryta-pl.iam.gserviceaccount.com",
      run,
    );

    expect(await token()).toBe("ya29.token");
    expect(await token()).toBe("ya29.token");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      "gcloud",
      [
        "auth",
        "print-access-token",
        "--impersonate-service-account=reader@koryta-pl.iam.gserviceaccount.com",
        "--quiet",
      ],
      { timeout: 60_000 },
    );
  });

  it("gives gcloud's reason, not its impersonation warning", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("Command failed"), {
        stderr:
          "WARNING: This command is using service account impersonation.\n" +
          "ERROR: (gcloud.auth.print-access-token) Failed to impersonate [reader].\n",
      });
    });
    await expect(impersonatedToken("reader", run)()).rejects.toThrow(
      /could not act as reader: ERROR: \(gcloud\.auth\.print-access-token\) Failed to impersonate/,
    );
  });
});

describe("connect", () => {
  it("reads the emulator when one is named", () => {
    expect(connect({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }).source).toBe(
      "the Firestore emulator at 127.0.0.1:8080",
    );
  });

  it("reads production as the reader account otherwise", () => {
    expect(connect({}).source).toBe(
      "production (koryta-pl/koryta-pl) as firestore-reader@koryta-pl.iam.gserviceaccount.com",
    );
    expect(connect({ KORYTA_FIRESTORE_READER: "other@x" }).source).toMatch(
      /as other@x$/,
    );
  });
});
