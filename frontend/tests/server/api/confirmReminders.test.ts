import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/admin/mail/confirm-reminders.post";
import { requireOwner } from "../../../server/utils/auth";
import {
  confirmReminderRecipients,
  queueConfirmReminders,
} from "../../../server/utils/confirmAddress";
import { loadAudience } from "../../../server/utils/mailAudience";

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  type Event = { body?: unknown };
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readValidatedBody: async (event: Event, parse: (b: unknown) => unknown) =>
      parse(event.body),
    setResponseHeader: vi.fn(),
  };
});

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));
vi.mock("~~/server/utils/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("~~/server/utils/mailAudience", () => ({ loadAudience: vi.fn() }));
vi.mock("~~/server/utils/confirmAddress", () => ({
  confirmReminderRecipients: vi.fn(),
  queueConfirmReminders: vi.fn(),
}));

type Handler = (event: unknown) => Promise<Record<string, unknown>>;
const call = (event: Record<string, unknown> = {}) =>
  (handler as unknown as Handler)(event);

const RECIPIENTS = [
  {
    uid: "a",
    email: "a@example.com",
    reasons: ["newsletter"],
    createdAt: null,
    lastSeenAt: null,
    reminded: false,
  },
  {
    uid: "b",
    email: "b@example.com",
    reasons: ["newsletter", "readings"],
    createdAt: null,
    lastSeenAt: null,
    reminded: false,
  },
  {
    uid: "c",
    email: "c@example.com",
    reasons: ["newsletter"],
    createdAt: null,
    lastSeenAt: null,
    reminded: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwner).mockResolvedValue({ uid: "owner" } as never);
  vi.mocked(loadAudience).mockResolvedValue({ members: [] } as never);
  vi.mocked(confirmReminderRecipients).mockResolvedValue(RECIPIENTS as never);
});

describe("POST /api/admin/mail/confirm-reminders", () => {
  it("refuses everybody but the owner", async () => {
    vi.mocked(requireOwner).mockRejectedValue(
      Object.assign(new Error("forbidden"), { statusCode: 403 }),
    );
    await expect(call({ body: { send: true } })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(loadAudience).not.toHaveBeenCalled();
    expect(queueConfirmReminders).not.toHaveBeenCalled();
  });

  it("only says who would get it and what it says, unless told to send", async () => {
    const answer = await call();
    expect(queueConfirmReminders).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ sent: false, recipients: RECIPIENTS });
    expect(answer.previews).toEqual([
      expect.objectContaining({ reasons: "newsletter" }),
      expect.objectContaining({ reasons: "newsletter+readings" }),
    ]);
  });

  it("queues it when told to, and says how many are left", async () => {
    vi.mocked(queueConfirmReminders).mockResolvedValue({
      a: "queued",
      b: "failed",
    });
    const answer = await call({ body: { send: true } });
    expect(queueConfirmReminders).toHaveBeenCalledWith(
      expect.anything(),
      RECIPIENTS,
      { siteUrl: expect.stringMatching(/^https?:\/\//) },
    );
    expect(answer).toMatchObject({
      sent: true,
      outcomes: { a: "queued", b: "failed" },
      left: 1,
    });
    expect(
      (answer.recipients as { uid: string; reminded: boolean }[]).map((r) => [
        r.uid,
        r.reminded,
      ]),
    ).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
    ]);
  });

  it("refuses a send flag that is not a boolean", async () => {
    await expect(call({ body: { send: "yes" } })).rejects.toThrow();
    expect(queueConfirmReminders).not.toHaveBeenCalled();
  });
});
