import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  acceptanceRate,
  actorLabel,
  describeRoleChange,
  lastSeenAt,
  levelFromSlug,
  levelSlugs,
  matchesUserSearch,
  rowFromResponse,
  trialDays,
  trialDue,
  useAdminUsers,
  userSectionOf,
  userSections,
} from "../../app/composables/adminUsers";
import { TRIAL_REVIEW_DAYS } from "../../shared/userAdmin";
import {
  NOW,
  daysBefore,
  userDetail,
  userRow,
  usersResponse,
} from "../components/admin/users/rows";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({ authRequest: mockAuthRequest }));

const admin = { level: "admin", trial: false, owner: false } as const;
const trialAdmin = { level: "admin", trial: true, owner: false } as const;

describe("userSectionOf", () => {
  it("puts an open request first, whatever else is true of the account", () => {
    expect(
      userSectionOf(
        userRow("a", {
          accessRequest: {
            reason: "Chcę pomagać przy imporcie.",
            source: "pomoc",
            createdAt: daysBefore(1),
            status: "open",
          },
          nomination: {
            desired: {
              level: "trusted",
              trial: false,
              reason: "x",
              by: "me",
              byName: null,
              at: daysBefore(1),
            },
            pending: true,
            applyError: null,
          },
        }),
      ),
    ).toBe("requests");
  });

  it("lists a handled request with the account's other sections", () => {
    expect(
      userSectionOf(
        userRow("a", {
          accessRequest: {
            reason: "Chcę pomagać.",
            source: "pomoc",
            createdAt: daysBefore(5),
            status: "dismissed",
          },
        }),
      ),
    ).toBe("others");
  });

  it("moves a trial that has a nomination waiting to the script's section", () => {
    const row = userRow("a", {
      current: trialAdmin,
      trialStartedAt: daysBefore(40),
      nomination: {
        desired: {
          level: "admin",
          trial: false,
          reason: "Dobrze sobie radzi.",
          by: "me",
          byName: "Ja",
          at: daysBefore(1),
        },
        pending: true,
        applyError: null,
      },
    });
    expect(userSectionOf(row)).toBe("pending");
    expect(userSectionOf({ ...row, nomination: null })).toBe("trials");
  });

  it("puts every level above a plain account in the team, and robots last", () => {
    expect(
      userSectionOf(
        userRow("a", {
          current: { level: "trusted", trial: false, owner: false },
        }),
      ),
    ).toBe("team");
    expect(userSectionOf(userRow("a", { current: admin }))).toBe("team");
    expect(userSectionOf(userRow("a"))).toBe("others");
    expect(
      userSectionOf(
        userRow("pipeline", {
          robot: true,
          current: { level: "datascience", trial: false, owner: false },
        }),
      ),
    ).toBe("others");
  });
});

describe("userSections", () => {
  it("orders the queues oldest first and the rest by who was here last", () => {
    const sections = userSections([
      userRow("recent-trial", {
        current: trialAdmin,
        trialStartedAt: daysBefore(3),
      }),
      userRow("undated-trial", { current: trialAdmin, trialStartedAt: null }),
      userRow("old-trial", {
        current: trialAdmin,
        trialStartedAt: daysBefore(45),
      }),
      userRow("ds", {
        current: { level: "datascience", trial: false, owner: false },
        lastRefreshAt: daysBefore(1),
      }),
      userRow("admin-idle", { current: admin, lastRefreshAt: daysBefore(60) }),
      userRow("owner", {
        current: { level: "admin", trial: false, owner: true },
        lastRefreshAt: daysBefore(30),
      }),
      userRow("admin-busy", { current: admin, lastRefreshAt: daysBefore(0) }),
      userRow("robot", { robot: true, lastRefreshAt: daysBefore(0) }),
      userRow("never-seen", { lastRefreshAt: null }),
      userRow("seen-today", {
        lastRefreshAt: daysBefore(9),
        signIns: {
          count: 2,
          activeDays: 3,
          firstSeenAt: daysBefore(20),
          lastSeenAt: daysBefore(0),
        },
      }),
      userRow("seen-week", { lastRefreshAt: daysBefore(7) }),
    ]);

    const uids = (key: keyof typeof sections) =>
      sections[key].map((row) => row.uid);
    // The trial that cannot be dated goes after the ones that can.
    expect(uids("trials")).toEqual([
      "old-trial",
      "recent-trial",
      "undated-trial",
    ]);
    // Administrators before the team, the owner first among them, then the
    // ones seen most recently.
    expect(uids("team")).toEqual(["owner", "admin-busy", "admin-idle", "ds"]);
    // A sign-in recorded today beats an older token refresh, and a robot goes
    // last even when it was busy.
    expect(uids("others")).toEqual([
      "seen-today",
      "seen-week",
      "never-seen",
      "robot",
    ]);
    expect(uids("requests")).toEqual([]);
  });

  it("orders requests and nominations by how long they have waited", () => {
    const request = (uid: string, days: number) =>
      userRow(uid, {
        accessRequest: {
          reason: "Proszę o dostęp do rozszerzenia.",
          source: "rozszerzenie",
          createdAt: daysBefore(days),
          status: "open",
        },
      });
    const nominated = (uid: string, days: number) =>
      userRow(uid, {
        nomination: {
          desired: {
            level: "trusted",
            trial: false,
            reason: "Pomaga od dawna.",
            by: "me",
            byName: "Ja",
            at: daysBefore(days),
          },
          pending: true,
          applyError: null,
        },
      });
    const sections = userSections([
      request("new", 1),
      nominated("fresh", 0),
      request("old", 6),
      nominated("stale", 9),
    ]);
    expect(sections.requests.map((row) => row.uid)).toEqual(["old", "new"]);
    expect(sections.pending.map((row) => row.uid)).toEqual(["stale", "fresh"]);
  });
});

describe("trials", () => {
  it("counts whole days and flags them from the review threshold on", () => {
    const row = (days: number) =>
      userRow("a", { current: trialAdmin, trialStartedAt: daysBefore(days) });
    expect(trialDays(row(12), NOW)).toBe(12);
    expect(trialDue(row(TRIAL_REVIEW_DAYS - 1), NOW)).toBe(false);
    expect(trialDue(row(TRIAL_REVIEW_DAYS), NOW)).toBe(true);
  });

  it("has no days for an account that is not on trial or cannot be dated", () => {
    expect(
      trialDays(
        userRow("a", { current: admin, trialStartedAt: daysBefore(50) }),
        NOW,
      ),
    ).toBeNull();
    const undated = userRow("a", { current: trialAdmin });
    expect(trialDays(undated, NOW)).toBeNull();
    expect(trialDue(undated, NOW)).toBe(false);
  });
});

describe("lastSeenAt", () => {
  it("takes the later of Auth's refresh and the recorded sign-in", () => {
    const signIns = (lastSeenAt: string) => ({
      count: 1,
      activeDays: 1,
      firstSeenAt: lastSeenAt,
      lastSeenAt,
    });
    expect(
      lastSeenAt(
        userRow("a", {
          lastRefreshAt: daysBefore(5),
          signIns: signIns(daysBefore(1)),
        }),
      ),
    ).toBe(daysBefore(1));
    expect(
      lastSeenAt(
        userRow("a", {
          lastRefreshAt: daysBefore(1),
          signIns: signIns(daysBefore(5)),
        }),
      ),
    ).toBe(daysBefore(1));
    expect(lastSeenAt(userRow("a", { lastRefreshAt: null }))).toBeNull();
  });
});

describe("matchesUserSearch", () => {
  const row = userRow("Xk29fAbc", {
    displayName: "Łukasz Żółkiewski",
    email: "lukasz@example.com",
  });

  it("finds a name typed without its Polish letters, an address and a uid", () => {
    expect(matchesUserSearch(row, "lukasz zol")).toBe(true);
    expect(matchesUserSearch(row, "ŁUKASZ")).toBe(true);
    expect(matchesUserSearch(row, "example.com")).toBe(true);
    expect(matchesUserSearch(row, "xk29")).toBe(true);
    expect(matchesUserSearch(row, "  ")).toBe(true);
    expect(matchesUserSearch(row, "kowalski")).toBe(false);
  });

  it("copes with an account that has no name and no address", () => {
    const bare = userRow("u1", { displayName: null, email: null });
    expect(matchesUserSearch(bare, "u1")).toBe(true);
    expect(matchesUserSearch(bare, "anna")).toBe(false);
  });
});

describe("level slugs", () => {
  it("reads every slug back as its level and nothing else as one", () => {
    for (const [level, slug] of Object.entries(levelSlugs)) {
      expect(levelFromSlug(slug)).toBe(level);
    }
    expect(levelFromSlug("admin")).toBeNull();
    expect(levelFromSlug(null)).toBeNull();
  });
});

describe("acceptanceRate", () => {
  it("is accepted out of decided, and nothing while nothing is decided", () => {
    expect(acceptanceRate({ approved: 3, rejected: 1 })).toBe(75);
    expect(acceptanceRate({ approved: 0, rejected: 0 })).toBeNull();
  });
});

describe("describeRoleChange", () => {
  it("prints before and after with the site's labels", () => {
    expect(
      describeRoleChange(
        { level: "normal", trial: false, owner: false },
        { level: "admin", trial: true },
      ),
    ).toBe("Uczestnik → Administrator (okres próbny)");
    expect(describeRoleChange(null, { level: "trusted", trial: false })).toBe(
      "Zaufany uczestnik",
    );
    expect(describeRoleChange(undefined, null)).toBeNull();
  });
});

describe("actorLabel", () => {
  it("names a person, and the claims script and the seed by what they are", () => {
    expect(actorLabel({ by: "admin-uid", byName: "Anna Admin" })).toBe(
      "Anna Admin",
    );
    expect(
      actorLabel({ by: "script:set_auth_claims@predator", byName: null }),
    ).toBe("skrypt uprawnień");
    // What `set_auth_claims --seed` writes into every seeded nomination.
    expect(actorLabel({ by: "migration:set_auth_claims", byName: null })).toBe(
      "migracja",
    );
  });

  it("falls back to the uid of an account nobody can name any more", () => {
    expect(actorLabel({ by: "deleted-uid", byName: null })).toBe("deleted-uid");
    expect(actorLabel({ by: "deleted-uid" })).toBe("deleted-uid");
  });
});

describe("rowFromResponse", () => {
  it("takes a whole row, bare or wrapped, and nothing less", () => {
    const row = userRow("a");
    expect(rowFromResponse(row)).toBe(row);
    expect(rowFromResponse({ row })).toBe(row);
    expect(
      rowFromResponse({ nomination: row.nomination, pending: true }),
    ).toBeNull();
    expect(rowFromResponse({ ok: true })).toBeNull();
    expect(rowFromResponse(null)).toBeNull();
  });
});

describe("useAdminUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for the scope it is given and keeps the list when a refresh fails", async () => {
    const list = usersResponse([userRow("a")]);
    mockAuthRequest.mockResolvedValueOnce(list);
    const users = useAdminUsers();

    await users.load("aktywni");
    expect(mockAuthRequest).toHaveBeenCalledWith("/api/admin/users", {
      method: "GET",
      query: { zakres: "aktywni" },
    });
    expect(users.data.value?.users.map((row) => row.uid)).toEqual(["a"]);

    mockAuthRequest.mockRejectedValueOnce({
      data: { message: "Serwer śpi." },
    });
    await users.load("wszyscy");
    expect(users.data.value?.users.map((row) => row.uid)).toEqual(["a"]);
    expect(users.error.value).toBe(
      "Nie udało się odświeżyć listy kont: Serwer śpi.",
    );
    expect(users.loading.value).toBe(false);
  });

  it("says the list could not be loaded when there was none yet", async () => {
    mockAuthRequest.mockRejectedValueOnce(new Error("Brak sieci"));
    const users = useAdminUsers();
    await users.load();
    expect(users.data.value).toBeNull();
    expect(users.error.value).toBe(
      "Nie udało się wczytać listy kont: Brak sieci",
    );
  });

  it("joins a load of the same scope and drops an answer for a scope it left", async () => {
    let answerFirst: (value: unknown) => void = () => {};
    mockAuthRequest
      .mockImplementationOnce(
        () => new Promise((resolve) => (answerFirst = resolve)),
      )
      .mockResolvedValueOnce(
        usersResponse([userRow("everyone")], { scope: "wszyscy" }),
      );
    const users = useAdminUsers();

    const first = users.load("aktywni");
    const joined = users.load("aktywni");
    expect(mockAuthRequest).toHaveBeenCalledTimes(1);

    await users.load("wszyscy");
    answerFirst(usersResponse([userRow("active")]));
    await Promise.all([first, joined]);

    expect(users.data.value?.scope).toBe("wszyscy");
    expect(users.data.value?.users.map((row) => row.uid)).toEqual(["everyone"]);
  });

  it("fetches an account's detail once and puts its fresher row in the list", async () => {
    const stale = userRow("a", { displayName: "Stara nazwa" });
    const fresh = userRow("a", { displayName: "Nowa nazwa" });
    mockAuthRequest
      .mockResolvedValueOnce(usersResponse([stale]))
      .mockResolvedValueOnce(userDetail(fresh));
    const users = useAdminUsers();
    await users.load();

    await users.loadDetail("a");
    await users.loadDetail("a");

    expect(mockAuthRequest).toHaveBeenCalledTimes(2);
    expect(mockAuthRequest).toHaveBeenLastCalledWith("/api/admin/users/a", {
      method: "GET",
    });
    expect(users.details.a?.data?.lifetime.votes).toBe(120);
    expect(users.data.value?.users[0]?.displayName).toBe("Nowa nazwa");
  });

  it("keeps the reason a detail failed, and tries again when asked", async () => {
    mockAuthRequest.mockRejectedValueOnce({
      data: { message: "Nie ma takiego konta." },
    });
    const users = useAdminUsers();
    await users.loadDetail("gone");
    expect(users.details.gone?.error).toBe(
      "Nie udało się wczytać szczegółów konta: Nie ma takiego konta.",
    );

    mockAuthRequest.mockResolvedValueOnce(userDetail(userRow("gone")));
    await users.loadDetail("gone", { force: true });
    expect(users.details.gone?.error).toBe("");
    expect(users.details.gone?.data).not.toBeNull();
  });

  it("puts the row a nomination answers with in place, and reloads an open detail", async () => {
    const before = userRow("a");
    const after = userRow("a", {
      nomination: {
        desired: {
          level: "trusted",
          trial: false,
          reason: "Pomaga od miesięcy.",
          by: "me",
          byName: "Ja",
          at: NOW.toISOString(),
        },
        pending: true,
        applyError: null,
      },
    });
    mockAuthRequest
      .mockResolvedValueOnce(usersResponse([before]))
      .mockResolvedValueOnce(userDetail(before))
      .mockResolvedValueOnce(after)
      .mockResolvedValueOnce(userDetail(after));
    const users = useAdminUsers();
    await users.load();
    await users.loadDetail("a");

    const body = {
      uid: "a",
      level: "trusted",
      trial: false,
      reason: "Pomaga od miesięcy.",
    } as const;
    const ok = await users.act({ kind: "nominate", body });

    expect(ok).toBe(true);
    expect(mockAuthRequest).toHaveBeenNthCalledWith(
      3,
      "/api/admin/users/nominate",
      { method: "POST", body },
    );
    expect(users.data.value?.users[0]?.nomination?.pending).toBe(true);
    await vi.waitFor(() =>
      expect(mockAuthRequest).toHaveBeenLastCalledWith("/api/admin/users/a", {
        method: "GET",
      }),
    );
    expect(users.snackbarColor.value).toBe("success");
    expect(users.snackbarText.value).toContain("Nominacja zapisana");
    expect(users.busy.has("a")).toBe(false);
  });

  it("asks for the list again when a write answers with less than a row", async () => {
    mockAuthRequest
      .mockResolvedValueOnce(usersResponse([userRow("a")]))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(
        usersResponse([
          userRow("a", {
            profile: { handle: "a", public: true, hidden: true },
          }),
        ]),
      );
    const users = useAdminUsers();
    await users.load("aktywni");

    const ok = await users.act({
      kind: "moderate",
      body: { uid: "a", action: "hideProfile", reason: "Obraźliwa nazwa." },
    });

    expect(ok).toBe(true);
    expect(mockAuthRequest).toHaveBeenNthCalledWith(
      2,
      "/api/admin/users/moderate",
      {
        method: "POST",
        body: { uid: "a", action: "hideProfile", reason: "Obraźliwa nazwa." },
      },
    );
    expect(mockAuthRequest).toHaveBeenNthCalledWith(3, "/api/admin/users", {
      method: "GET",
      query: { zakres: "aktywni" },
    });
    expect(users.data.value?.users[0]?.profile.hidden).toBe(true);
    expect(users.snackbarText.value).toBe("Profil ukryty.");
  });

  it("sends each write to its own route", async () => {
    mockAuthRequest.mockResolvedValue(userRow("a"));
    const users = useAdminUsers();
    await users.nominate({ uid: "a", level: "trusted", reason: "Pomaga." });
    await users.withdraw({ uid: "a" });
    await users.dismissRequest({ uid: "a", reason: "Za wcześnie." });
    await users.moderate({
      uid: "a",
      action: "resetName",
      reason: "Wulgarna.",
    });
    expect(mockAuthRequest.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/users/nominate",
      "/api/admin/users/withdraw",
      "/api/admin/users/dismiss-request",
      "/api/admin/users/moderate",
    ]);
    expect(users.snackbarText.value).toBe("Nazwa użytkownika usunięta.");
  });

  it("reports a refused write in the server's words and says it failed", async () => {
    mockAuthRequest.mockRejectedValueOnce({
      data: { message: "Nie możesz nominować samego siebie." },
    });
    const users = useAdminUsers();
    const ok = await users.act({
      kind: "nominate",
      body: { uid: "me", level: "admin", reason: "Bo tak." },
    });
    expect(ok).toBe(false);
    expect(users.snackbar.value).toBe(true);
    expect(users.snackbarColor.value).toBe("error");
    expect(users.snackbarText.value).toBe(
      "Nie możesz nominować samego siebie.",
    );
    expect(users.busy.has("me")).toBe(false);
  });
});
