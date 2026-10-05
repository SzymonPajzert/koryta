import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  identify,
  listNewAdmins,
  readPublicProfiles,
} from "../../../server/utils/contributors";

const { mockGetUsers, mockListUsers } = vi.hoisted(() => ({
  mockGetUsers: vi.fn(),
  mockListUsers: vi.fn(),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUsers: mockGetUsers, listUsers: mockListUsers }),
}));

type Ref = { collection: string; id: string };

/** Just enough of a Firestore for `readPublicProfiles`: `users` documents by
 * id, and a record of every `getAll` call with its read options. */
function fakeDb(docs: Record<string, Record<string, unknown>>) {
  const calls: { refs: Ref[]; options: unknown }[] = [];
  const db = {
    collection: (collection: string) => ({
      doc: (id: string): Ref => ({ collection, id }),
    }),
    getAll: async (...args: unknown[]) => {
      const refs = args.slice(0, -1) as Ref[];
      calls.push({ refs, options: args[args.length - 1] });
      return refs.map((ref) => ({ id: ref.id, data: () => docs[ref.id] }));
    },
  };
  return { db: db as unknown as FirebaseFirestore.Firestore, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("identify", () => {
  it("reads display data and roles from the account", async () => {
    mockGetUsers.mockResolvedValue({
      users: [
        {
          uid: "est",
          displayName: "Szymon",
          email: "s@example.com",
          customClaims: { admin: true },
        },
        {
          uid: "trial",
          displayName: "Mikołaj",
          customClaims: { admin: true, newAdmin: true },
        },
        // A trial ended by demotion that left the flag behind.
        { uid: "demoted", customClaims: { newAdmin: true } },
        { uid: "plain" },
      ],
      notFound: [{ uid: "gone" }],
    });

    const found = await identify(["est", "trial", "demoted", "plain", "gone"]);

    expect(found.est).toEqual({
      displayName: "Szymon",
      email: "s@example.com",
      photoURL: null,
      admin: true,
      newAdmin: false,
    });
    expect(found.trial).toMatchObject({ admin: true, newAdmin: true });
    expect(found.demoted).toMatchObject({ admin: false, newAdmin: false });
    expect(found.plain).toMatchObject({ admin: false, newAdmin: false });
    expect(found).not.toHaveProperty("gone");
  });

  it("asks the auth service at most 100 uids at a time", async () => {
    mockGetUsers.mockResolvedValue({ users: [], notFound: [] });
    const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);

    await identify(uids);

    expect(mockGetUsers.mock.calls.map(([ids]) => ids.length)).toEqual([
      100, 100, 50,
    ]);
  });

  it("asks nothing for nobody", async () => {
    expect(await identify([])).toEqual({});
    expect(mockGetUsers).not.toHaveBeenCalled();
  });
});

describe("readPublicProfiles", () => {
  it("names only those who turned the setting on", async () => {
    const { db } = fakeDb({
      on: { publicProfile: true },
      off: { publicProfile: false },
      unset: { newsletter: { recentPeople: true } },
    });

    expect(
      await readPublicProfiles(db, ["on", "off", "unset", "gone"]),
    ).toEqual({ on: true, off: false, unset: false, gone: false });
  });

  it("reads the one field and nothing else of an owner-writable document", async () => {
    const { db, calls } = fakeDb({});

    await readPublicProfiles(db, ["a"]);

    expect(calls[0]!.options).toEqual({ fieldMask: ["publicProfile"] });
  });

  it("reads in chunks, and not at all for nobody", async () => {
    const { db, calls } = fakeDb({});

    await readPublicProfiles(db, []);
    expect(calls).toHaveLength(0);

    await readPublicProfiles(
      db,
      Array.from({ length: 301 }, (_, i) => `u${i}`),
    );
    expect(calls.map((call) => call.refs.length)).toEqual([300, 1]);
  });
});

describe("listNewAdmins", () => {
  it("walks every page and keeps administrators on trial", async () => {
    mockListUsers.mockImplementation(async (_max: number, token?: string) =>
      token === "2"
        ? {
            users: [
              { uid: "trial-b", customClaims: { admin: true, newAdmin: true } },
            ],
          }
        : {
            users: [
              { uid: "trial-a", customClaims: { admin: true, newAdmin: true } },
              { uid: "est", customClaims: { admin: true } },
              { uid: "demoted", customClaims: { newAdmin: true } },
              { uid: "plain" },
            ],
            pageToken: "2",
          },
    );

    expect(await listNewAdmins()).toEqual(["trial-a", "trial-b"]);
    expect(mockListUsers.mock.calls).toEqual([
      [1000, undefined],
      [1000, "2"],
    ]);
  });

  it("stops after ten pages and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let page = 0;
    mockListUsers.mockImplementation(async () => {
      page += 1;
      return {
        users: [
          {
            uid: `trial-${page}`,
            customClaims: { admin: true, newAdmin: true },
          },
        ],
        pageToken: `after-${page}`,
      };
    });

    const found = await listNewAdmins();

    expect(mockListUsers).toHaveBeenCalledTimes(10);
    expect(found).toHaveLength(10);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
