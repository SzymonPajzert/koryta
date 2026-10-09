import { describe, it, expect, vi, beforeEach } from "vitest";
import audienceHandler from "../../../server/api/admin/mail/audience.get";
import saveHandler from "../../../server/api/admin/mail/save.post";
import sendHandler from "../../../server/api/admin/mail/send.post";
import testHandler from "../../../server/api/admin/mail/test.post";
import unsubscribeHandler from "../../../server/api/mail/unsubscribe.post";
import unsubscribeRedirect from "../../../server/api/mail/unsubscribe.get";
import { requireOwner } from "../../../server/utils/auth";
import {
  getCampaign,
  queueCampaign,
  queueTest,
  saveCampaign,
} from "../../../server/utils/mailCampaigns";
import { loadAudience } from "../../../server/utils/mailAudience";
import { unsubscribe } from "../../../server/utils/mailTokens";

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  type Event = { body?: unknown; query?: Record<string, string>; url?: string };
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readValidatedBody: async (event: Event, parse: (b: unknown) => unknown) =>
      parse(event.body),
    readBody: async (event: Event) => event.body,
    getQuery: (event: Event) => event.query ?? {},
    setResponseHeader: vi.fn(),
    getRequestURL: (event: Event) => new URL(event.url!),
    sendRedirect: (_event: Event, location: string, code: number) => ({
      location,
      code,
    }),
  };
});

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));
vi.mock("~~/server/utils/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("~~/server/utils/mailAudience", () => ({
  loadAudience: vi.fn(),
  queueToCheck: vi.fn(async () => 12),
}));
vi.mock("~~/server/utils/mailTokens", () => ({ unsubscribe: vi.fn() }));
vi.mock("~~/server/utils/mailCampaigns", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~~/server/utils/mailCampaigns")>();
  return {
    // The real schema, so validation is what ships.
    campaignContentSchema: actual.campaignContentSchema,
    getCampaign: vi.fn(),
    queueCampaign: vi.fn(),
    queueTest: vi.fn(),
    saveCampaign: vi.fn(),
  };
});

type Handler = (event: unknown) => Promise<unknown>;
const call = (handler: unknown, event: Record<string, unknown> = {}) =>
  (handler as Handler)(event);

const CONTENT = {
  subject: "Temat",
  body: "Treść",
  ctaLabel: "Sprawdź",
  ctaPath: "/eksploruj/nowe",
  topic: "callsToAction",
  includeStats: true,
};

const AUDIENCE = {
  members: [{ uid: "owner" }, { uid: "a" }],
  community: { days: 30, votes: 1, voters: 1, publications: 0, toCheck: 12 },
  generatedAt: "2026-10-09T12:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwner).mockResolvedValue({ uid: "owner" } as never);
  vi.mocked(loadAudience).mockResolvedValue(AUDIENCE as never);
  vi.mocked(getCampaign).mockResolvedValue({ id: "2026-10-09-temat" } as never);
});

describe("the owner's mail routes", () => {
  it("refuse everybody but the owner", async () => {
    vi.mocked(requireOwner).mockRejectedValue(
      Object.assign(new Error("forbidden"), { statusCode: 403 }),
    );
    for (const handler of [
      audienceHandler,
      saveHandler,
      sendHandler,
      testHandler,
    ]) {
      await expect(
        call(handler, { body: { id: "x", uids: ["a"], content: CONTENT } }),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(loadAudience).not.toHaveBeenCalled();
    expect(queueCampaign).not.toHaveBeenCalled();
  });

  it("list the audience with the queue count", async () => {
    expect(await call(audienceHandler)).toBe(AUDIENCE);
    expect(loadAudience).toHaveBeenCalledWith(expect.anything(), {
      toCheck: 12,
    });
  });

  it("save a draft only if its button links somewhere on the site", async () => {
    vi.mocked(saveCampaign).mockResolvedValue({ id: "new" } as never);
    await call(saveHandler, { body: { content: CONTENT } });
    expect(saveCampaign).toHaveBeenCalledWith(expect.anything(), {
      id: undefined,
      content: CONTENT,
      by: "owner",
      now: expect.any(Date),
    });

    await expect(
      call(saveHandler, {
        body: { content: { ...CONTENT, ctaPath: "https://evil.example" } },
      }),
    ).rejects.toThrow();
    await expect(
      call(saveHandler, { body: { content: { ...CONTENT, ctaPath: "" } } }),
    ).rejects.toThrow();
  });

  it("send to the ticked people, checked against a fresh audience", async () => {
    vi.mocked(queueCampaign).mockResolvedValue({ outcomes: {} } as never);
    await call(sendHandler, { body: { id: "2026-10-09-temat", uids: ["a"] } });
    expect(queueCampaign).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        campaign: { id: "2026-10-09-temat" },
        members: AUDIENCE.members,
        community: AUDIENCE.community,
        uids: ["a"],
        by: "owner",
        // The deployment's own address, from the runtime config.
        siteUrl: expect.stringMatching(/^https?:\/\//),
      }),
    );
  });

  it("refuse a send nobody is picked for, or of a campaign that does not exist", async () => {
    await expect(
      call(sendHandler, { body: { id: "2026-10-09-temat", uids: [] } }),
    ).rejects.toThrow();
    vi.mocked(getCampaign).mockResolvedValue(null);
    await expect(
      call(sendHandler, { body: { id: "2026-10-09-temat", uids: ["a"] } }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(queueCampaign).not.toHaveBeenCalled();
  });

  it("send a test to the owner's own account", async () => {
    vi.mocked(queueTest).mockResolvedValue({ outcome: "queued" } as never);
    await call(testHandler, { body: { id: "2026-10-09-temat" } });
    expect(queueTest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ member: { uid: "owner" } }),
    );
  });
});

describe("unsubscribing", () => {
  it("takes the parameters from the page's JSON", async () => {
    vi.mocked(unsubscribe).mockResolvedValue("unsubscribed");
    expect(
      await call(unsubscribeHandler, {
        body: { u: "a", t: "tok", k: "recentPeople", c: "2026-10-09-temat" },
      }),
    ).toEqual({ outcome: "unsubscribed", topic: "recentPeople" });
    expect(unsubscribe).toHaveBeenCalledWith(expect.anything(), {
      uid: "a",
      token: "tok",
      topic: "recentPeople",
      campaignId: "2026-10-09-temat",
    });
  });

  it("takes a mail client's one-click post, whose parameters are in the URL", async () => {
    vi.mocked(unsubscribe).mockResolvedValue("unsubscribed");
    await call(unsubscribeHandler, {
      query: { u: "a", t: "tok", k: "callsToAction" },
      body: { "List-Unsubscribe": "One-Click" },
    });
    expect(unsubscribe).toHaveBeenCalledWith(expect.anything(), {
      uid: "a",
      token: "tok",
      topic: "callsToAction",
      campaignId: undefined,
    });
  });

  it("says so when the link is cut short or wrong", async () => {
    await expect(
      call(unsubscribeHandler, { body: { u: "a", k: "callsToAction" } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      call(unsubscribeHandler, { body: { u: "a", t: "t", k: "everything" } }),
    ).rejects.toMatchObject({ statusCode: 400 });

    vi.mocked(unsubscribe).mockResolvedValue("invalid");
    await expect(
      call(unsubscribeHandler, {
        body: { u: "a", t: "bad", k: "callsToAction" },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("sends a browser that opens the header's address to the page that asks first", async () => {
    expect(
      await call(unsubscribeRedirect, {
        url: "https://koryta.pl/api/mail/unsubscribe?u=a&t=tok&k=callsToAction",
      }),
    ).toEqual({ location: "/wypisz?u=a&t=tok&k=callsToAction", code: 302 });
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
