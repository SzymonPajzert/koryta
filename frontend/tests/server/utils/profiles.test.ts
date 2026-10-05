import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { FakeFirestore } from "../fakeFirestore";
import {
  HANDLE_CHANGES_PER_DAY,
  ensureHandle,
  handleFromName,
  openProfilePath,
  ownProfileSettings,
  profileCounts,
  readProfiles,
  replaceHandleWithNeutral,
  setHandle,
} from "../../../server/utils/profiles";
import { isValidHandle, type ProfileDoc } from "../../../shared/userAdmin";

vi.hoisted(() => {
  // Nitro auto-imports createError into server utils; stub it as the route
  // tests do.
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);
});

const fake = new FakeFirestore();
const db = fake as unknown as Firestore;

const profile = (fields: Partial<ProfileDoc> = {}): ProfileDoc => ({
  handle: null,
  avatarImageId: null,
  hidden: null,
  ...fields,
});

beforeEach(() => {
  fake.reset();
});

describe("handleFromName", () => {
  it("folds a Polish name the way a page slug is folded", () => {
    expect(handleFromName("Łukasz Żółć-Ślęzak")).toBe("lukasz-zolc-slezak");
    expect(handleFromName("  Anna   Nowak ")).toBe("anna-nowak");
  });

  it("keeps a long name inside the limit without a hyphen at the end", () => {
    const handle = handleFromName("Bartłomiej Wiśniewski-Kowalczyk Zawadzki");

    expect(handle).toBe("bartlomiej-wisniewski-kowalczy");
    expect(isValidHandle(handle!)).toBe(true);
    // Cut exactly where a hyphen was: the hyphen goes, since a handle may not
    // end on one.
    expect(handleFromName("Abcdefghijklmnopqrstuvwxyzabc D")).toBe(
      "abcdefghijklmnopqrstuvwxyzabc",
    );
  });

  it("has no handle for a name that folds to nothing usable", () => {
    expect(handleFromName(null)).toBeNull();
    expect(handleFromName("")).toBeNull();
    expect(handleFromName("Jo")).toBeNull();
    expect(handleFromName("李小龍")).toBeNull();
  });

  it("never hands out a word the site speaks with", () => {
    expect(handleFromName("Admin")).toBeNull();
    expect(handleFromName("Redakcja")).toBeNull();
    expect(handleFromName("Zespół")).toBeNull();
  });
});

describe("ensureHandle", () => {
  it("claims the name's handle for the account", async () => {
    const handle = await ensureHandle(db, "u1", "Anna Nowak");

    expect(handle).toBe("anna-nowak");
    expect(fake.read("profileHandles/anna-nowak")).toEqual({
      uid: "u1",
      createdAt: expect.any(String),
    });
    expect(fake.read("profiles/u1")).toEqual({
      handle: "anna-nowak",
      avatarImageId: null,
      hidden: null,
    });
  });

  it("keeps what the profile already holds next to the handle", async () => {
    fake.seed("profiles/u1", { avatarImageId: "img1", hidden: null });

    await ensureHandle(db, "u1", "Anna Nowak");

    expect(fake.read("profiles/u1")).toEqual({
      handle: "anna-nowak",
      avatarImageId: "img1",
      hidden: null,
    });
  });

  it("returns the handle an account has, without writing", async () => {
    fake.seed("profiles/u1", profile({ handle: "ania" }));

    expect(await ensureHandle(db, "u1", "Anna Nowak")).toBe("ania");
    expect(fake.writes).toEqual([]);
  });

  it("numbers a namesake rather than handing them somebody else's address", async () => {
    expect(await ensureHandle(db, "u1", "Anna Nowak")).toBe("anna-nowak");
    expect(await ensureHandle(db, "u2", "Anna Nowak")).toBe("anna-nowak-2");
    expect(await ensureHandle(db, "u3", "Anna Nowak")).toBe("anna-nowak-3");

    expect(fake.read("profileHandles/anna-nowak")).toMatchObject({
      uid: "u1",
    });
    expect(fake.read("profileHandles/anna-nowak-2")).toMatchObject({
      uid: "u2",
    });
  });

  it("makes room for the number in a name already at the limit", async () => {
    const name = "Abcdefghij Abcdefghij Abcdefghij";
    await ensureHandle(db, "u1", name);

    const second = await ensureHandle(db, "u2", name);

    expect(second).toBe("abcdefghij-abcdefghij-abcdef-2");
    expect(second.length).toBeLessThanOrEqual(30);
  });

  it("gives an account with no usable name a neutral handle", async () => {
    for (const [uid, name] of [
      ["u1", null],
      ["u2", "Admin"],
      ["u3", "Jo"],
    ] as const) {
      const handle = await ensureHandle(db, uid, name);

      expect(handle).toMatch(/^uczestnik-[a-z0-9]{4}$/);
      expect(isValidHandle(handle)).toBe(true);
      expect(fake.read(`profileHandles/${handle}`)).toMatchObject({ uid });
    }
  });

  it("takes back a handle document that is already the account's own", async () => {
    // A handle written by hand, or by an earlier run that set the document but
    // not the profile: claiming it again must not fail on `create`.
    fake.seed("profileHandles/anna-nowak", {
      uid: "u1",
      createdAt: "2026-10-01T00:00:00.000Z",
    });

    expect(await ensureHandle(db, "u1", "Anna Nowak")).toBe("anna-nowak");
    expect(fake.read("profileHandles/anna-nowak")).toMatchObject({
      createdAt: "2026-10-01T00:00:00.000Z",
    });
  });
});

describe("setHandle", () => {
  const now = new Date("2026-10-05T12:00:00.000Z");

  beforeEach(async () => {
    await ensureHandle(db, "u1", "Anna Nowak");
    fake.writes = [];
  });

  it("moves the account to the new handle and lets the old one go", async () => {
    expect(await setHandle(db, "u1", "ania-z-krakowa", now)).toBe(
      "ania-z-krakowa",
    );

    expect(fake.read("profileHandles/ania-z-krakowa")).toMatchObject({
      uid: "u1",
    });
    expect(fake.read("profileHandles/anna-nowak")).toBeUndefined();
    expect(fake.read("profiles/u1")).toMatchObject({
      handle: "ania-z-krakowa",
      handleChanges: { day: "2026-10-05", count: 1 },
    });
  });

  it("gives a first handle to an account that had none", async () => {
    expect(await setHandle(db, "u2", "bartek", now)).toBe("bartek");
    expect(fake.read("profiles/u2")).toMatchObject({ handle: "bartek" });
  });

  it("refuses a handle somebody else holds", async () => {
    await expect(setHandle(db, "u2", "anna-nowak", now)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(fake.read("profileHandles/anna-nowak")).toMatchObject({
      uid: "u1",
    });
    expect(fake.writes).toEqual([]);
  });

  it("does nothing for the handle the account already has", async () => {
    expect(await setHandle(db, "u1", "anna-nowak", now)).toBe("anna-nowak");
    expect(fake.writes).toEqual([]);
  });

  it(`allows ${HANDLE_CHANGES_PER_DAY} changes a day, and more the next`, async () => {
    for (let i = 1; i <= HANDLE_CHANGES_PER_DAY; i++) {
      await setHandle(db, "u1", `anna-${i}`, now);
    }

    await expect(setHandle(db, "u1", "anna-6", now)).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(fake.read("profiles/u1")).toMatchObject({
      handle: `anna-${HANDLE_CHANGES_PER_DAY}`,
    });

    const tomorrow = new Date("2026-10-06T08:00:00.000Z");
    expect(await setHandle(db, "u1", "anna-6", tomorrow)).toBe("anna-6");
    expect(fake.read("profiles/u1")).toMatchObject({
      handleChanges: { day: "2026-10-06", count: 1 },
    });
  });

  it("leaves another account's document alone when the old one is not ours", async () => {
    // A profile pointing at a handle whose document says somebody else: the
    // profile is wrong, and deleting the document would free their address.
    fake.seed("profiles/u3", profile({ handle: "anna-nowak" }));

    await setHandle(db, "u3", "trzecia", now);

    expect(fake.read("profileHandles/anna-nowak")).toMatchObject({
      uid: "u1",
    });
  });
});

describe("replaceHandleWithNeutral", () => {
  const now = new Date("2026-10-05T12:00:00.000Z");
  /** Runs it in a transaction of its own, as the moderation route does
   * alongside its other writes. */
  const replace = (uid: string) =>
    db.runTransaction((tx) => replaceHandleWithNeutral(db, tx, uid, now));

  beforeEach(async () => {
    await ensureHandle(db, "u1", "Kowalski to złodziej");
    fake.writes = [];
  });

  it("moves the account to a neutral handle and lets the old one go", async () => {
    const moved = await replace("u1");

    expect(moved).toEqual({
      from: "kowalski-to-zlodziej",
      to: expect.stringMatching(/^uczestnik-[a-z0-9]{4}$/),
    });
    expect(fake.read("profileHandles/kowalski-to-zlodziej")).toBeUndefined();
    expect(fake.read(`profileHandles/${moved!.to}`)).toEqual({
      uid: "u1",
      createdAt: now.toISOString(),
    });
    expect(fake.read("profiles/u1")).toMatchObject({ handle: moved!.to });
  });

  it("does not count against the owner's changes for the day", async () => {
    for (let i = 1; i < HANDLE_CHANGES_PER_DAY; i++) {
      await setHandle(db, "u1", `kowalski-${i}`, now);
    }
    const before = fake.read("profiles/u1")?.handleChanges;

    await replace("u1");

    expect(fake.read("profiles/u1")?.handleChanges).toEqual(before);
    // The owner still has the one change left today.
    expect(await setHandle(db, "u1", "jan-kowalski", now)).toBe("jan-kowalski");
  });

  it("keeps what the profile holds next to the handle", async () => {
    fake.seed("profiles/u1", {
      ...fake.read("profiles/u1"),
      avatarImageId: "img1",
      hidden: { by: "boss", at: "2026-10-04T00:00:00Z", reason: "Spam" },
    });

    await replace("u1");

    expect(fake.read("profiles/u1")).toMatchObject({
      avatarImageId: "img1",
      hidden: { reason: "Spam" },
    });
  });

  it("leaves another account's document alone when the old one is not ours", async () => {
    fake.seed("profiles/u3", profile({ handle: "kowalski-to-zlodziej" }));

    expect(await replace("u3")).toMatchObject({
      from: "kowalski-to-zlodziej",
    });
    expect(fake.read("profileHandles/kowalski-to-zlodziej")).toMatchObject({
      uid: "u1",
    });
  });

  it("has nothing to do without a handle, or with a neutral one", async () => {
    fake.seed("profiles/u2", profile());
    fake.seed("profiles/u4", profile({ handle: "uczestnik-ab12" }));

    expect(await replace("u2")).toBeNull();
    expect(await replace("u4")).toBeNull();
    expect(await replace("nobody")).toBeNull();
    expect(fake.writes).toEqual([]);
  });

  it("lands together with the caller's own writes", async () => {
    // The fake refuses a read after a write, as Firestore does: the handle's
    // reads all come first, and the caller's writes can follow them.
    await db.runTransaction(async (tx) => {
      await replaceHandleWithNeutral(db, tx, "u1", now);
      tx.set(db.collection("users").doc("u1"), { touched: true });
    });

    expect(fake.read("users/u1")).toEqual({ touched: true });
  });
});

describe("readProfiles", () => {
  it("reads in chunks and leaves out accounts with no profile", async () => {
    const uids = Array.from({ length: 301 }, (_, i) => `u${i}`);
    fake.seed("profiles/u0", profile({ handle: "zero" }));
    fake.seed("profiles/u300", { avatarImageId: "img300" });

    const found = await readProfiles(db, uids);

    expect(fake.getAllCalls.map((call) => call.paths.length)).toEqual([300, 1]);
    expect(Object.keys(found).sort()).toEqual(["u0", "u300"]);
    // Fields a document never had read as null, so callers need not care
    // which writer created it.
    expect(found.u300).toEqual(profile({ avatarImageId: "img300" }));
  });

  it("asks for nothing when there is nobody to read", async () => {
    expect(await readProfiles(db, [])).toEqual({});
    expect(fake.getAllCalls).toEqual([]);
  });
});

describe("openProfilePath", () => {
  it("is a path only for a handle its owner made public and nobody hid", () => {
    const withHandle = profile({ handle: "anna-nowak" });

    expect(openProfilePath(withHandle, true)).toBe("/uczestnik/anna-nowak");
    expect(openProfilePath(withHandle, false)).toBeNull();
    expect(openProfilePath(profile(), true)).toBeNull();
    expect(openProfilePath(undefined, true)).toBeNull();
    expect(
      openProfilePath(
        profile({
          handle: "anna-nowak",
          hidden: { by: "a", at: "2026-10-05", reason: "spam" },
        }),
        true,
      ),
    ).toBeNull();
  });
});

describe("ownProfileSettings", () => {
  const name = vi.fn(async () => "Anna Nowak");

  beforeEach(() => name.mockClear());

  it("gives a public account its handle and address", async () => {
    fake.seed("users/u1", { publicProfile: true, notifications: {} });
    fake.seed("profiles/u1", profile({ avatarImageId: "img1" }));

    expect(await ownProfileSettings(db, "u1", name)).toEqual({
      publicProfile: true,
      handle: "anna-nowak",
      path: "/uczestnik/anna-nowak",
      hidden: false,
      avatar: "/api/images/img1",
    });
    // One boolean out of a document its owner may fill with anything.
    expect(fake.getAllCalls[0]).toEqual({
      paths: ["users/u1"],
      fieldMask: ["publicProfile"],
    });
  });

  it("hands out no handle to an account that has not opted in", async () => {
    fake.seed("users/u1", { publicProfile: false });

    expect(await ownProfileSettings(db, "u1", name)).toEqual({
      publicProfile: false,
      handle: null,
      path: null,
      hidden: false,
      avatar: null,
    });
    expect(name).not.toHaveBeenCalled();
    expect(fake.read("profiles/u1")).toBeUndefined();
  });

  it("treats an account that never saved a setting as private", async () => {
    expect((await ownProfileSettings(db, "u1", name)).publicProfile).toBe(
      false,
    );
  });

  it("keeps the handle but gives no address while the profile is hidden", async () => {
    fake.seed("users/u1", { publicProfile: true });
    fake.seed(
      "profiles/u1",
      profile({
        handle: "anna-nowak",
        hidden: { by: "a", at: "2026-10-05T00:00:00.000Z", reason: "spam" },
      }),
    );

    expect(await ownProfileSettings(db, "u1", name)).toMatchObject({
      handle: "anna-nowak",
      path: null,
      hidden: true,
    });
  });

  it("does not hand a robot a profile", async () => {
    fake.seed("users/pipeline-people-import", { publicProfile: true });

    expect(
      await ownProfileSettings(db, "pipeline-people-import", name),
    ).toMatchObject({ handle: null, path: null });
    expect(fake.writes).toEqual([]);
  });
});

describe("profileCounts", () => {
  it("counts by document, proposals by hand only", async () => {
    fake.seed("votes/a_u1", { userUid: "u1" });
    fake.seed("votes/b_u1", { userUid: "u1" });
    fake.seed("votes/a_u2", { userUid: "u2" });
    fake.seed("notes/a_u1", { userUid: "u1" });
    fake.seed("revisions/r1", {
      update_user: "u1",
      update_automatic: false,
      status: "approved",
    });
    fake.seed("revisions/r2", {
      update_user: "u1",
      update_automatic: false,
      status: "pending",
    });
    fake.seed("revisions/r3", {
      update_user: "u1",
      update_automatic: true,
      status: "approved",
    });
    // Legacy revisions carry no flag at all, and are not counted as by hand.
    fake.seed("revisions/r4", { update_user: "u1", status: "approved" });

    expect(await profileCounts(db, "u1")).toEqual({
      votes: 2,
      notes: 1,
      proposals: 2,
      accepted: 1,
    });
    // Four aggregations and not one document read.
    expect(fake.counts).toHaveLength(4);
    expect(fake.reads).toEqual([]);
  });
});
