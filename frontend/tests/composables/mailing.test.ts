import { describe, it, expect, vi } from "vitest";
import {
  campaignSendNotice,
  campaignSendQuestion,
  campaignStanding,
} from "../../app/composables/mailing";
import type {
  CampaignQueue,
  Delivery,
  SendOutcome,
} from "../../shared/campaigns";

vi.mock("../../app/composables/auth", () => ({ authRequest: vi.fn() }));

const delivery = (state: Delivery["state"]): Delivery => ({
  state,
  queuedAt: null,
  finishedAt: null,
  error: null,
});

/** A send's answer: `counts` of each outcome, one made-up uid apiece. */
function outcomes(
  counts: Partial<Record<SendOutcome, number>>,
): Record<string, SendOutcome> {
  const answer: Record<string, SendOutcome> = {};
  for (const [outcome, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      answer[`${outcome}-${i}`] = outcome as SendOutcome;
    }
  }
  return answer;
}

const queue = (waiting: number, leftToday: number): CampaignQueue => ({
  waiting,
  leftToday,
});

describe("campaignStanding", () => {
  it("lets a withdrawn message be sent again", () => {
    // A message withdrawn before it went never reached the reader, and the
    // server writes it afresh. Counted as received, the reader could not be
    // ticked, though they may be written to again.
    expect(campaignStanding(delivery("WITHDRAWN"), true)).toEqual({
      failed: false,
      received: false,
    });
  });

  it("marks a failed delivery as failed, and not as received", () => {
    expect(campaignStanding(delivery("ERROR"), true)).toEqual({
      failed: true,
      received: false,
    });
  });

  it("counts a message that went, waits or is on its way as received", () => {
    for (const state of [
      "SUCCESS",
      "queued",
      "PENDING",
      "PROCESSING",
      "RETRY",
    ] as const) {
      expect(campaignStanding(delivery(state), true)).toEqual({
        failed: false,
        received: true,
      });
    }
  });

  it("counts nobody who was never sent it", () => {
    expect(campaignStanding(null, false)).toEqual({
      failed: false,
      received: false,
    });
  });
});

describe("campaignSendQuestion", () => {
  it("says a send to whoever it failed to reach goes again", () => {
    expect(campaignSendQuestion(11, 11)).toBe(
      "Kampania pójdzie ponownie do 11 osób, po błędzie wysyłki.",
    );
    expect(campaignSendQuestion(1, 1)).toBe(
      "Kampania pójdzie ponownie do 1 osoby, po błędzie wysyłki.",
    );
  });

  it("names the re-sends among the rest", () => {
    expect(campaignSendQuestion(36, 11)).toBe(
      "Kampania pójdzie do 36 osób (do 11 z nich ponownie, po błędzie wysyłki).",
    );
    expect(campaignSendQuestion(25, 0)).toBe("Kampania pójdzie do 25 osób.");
  });

  it("does not call nobody a re-send", () => {
    // A send empties the selection while the dialog still fades out; it read
    // „pójdzie ponownie do 0 osób, po błędzie wysyłki” for that moment.
    expect(campaignSendQuestion(0, 0)).toBe("Kampania pójdzie do 0 osób.");
  });
});

describe("campaignSendNotice", () => {
  it("says the mail goes out within minutes when today's allowance covers it", () => {
    expect(campaignSendNotice(outcomes({ queued: 25 }), queue(25, 90))).toEqual(
      {
        text: "Wysłano do kolejki: 25. Wychodzą po 20 na minutę.",
        color: "success",
      },
    );
  });

  it("says a send of re-sends alone is back in the queue", () => {
    expect(
      campaignSendNotice(outcomes({ requeued: 11 }), queue(11, 90)).text,
    ).toBe("Ponownie do kolejki: 11. Wychodzą po 20 na minutę.");
  });

  it("says how many go today and that the rest go from tomorrow", () => {
    expect(
      campaignSendNotice(outcomes({ queued: 25, requeued: 11 }), queue(36, 20))
        .text,
    ).toBe(
      "Wysłano do kolejki: 36, w tym ponownie: 11. Dziś wyjdzie jeszcze 20, reszta od jutra.",
    );
  });

  it("puts the verb in the plural for two to four", () => {
    const today = (left: number) =>
      campaignSendNotice(outcomes({ queued: 40 }), queue(40, left)).text;
    expect(today(3)).toContain("Dziś wyjdą jeszcze 3,");
    expect(today(22)).toContain("Dziś wyjdą jeszcze 22,");
    expect(today(12)).toContain("Dziś wyjdzie jeszcze 12,");
    expect(today(1)).toContain("Dziś wyjdzie jeszcze 1,");
  });

  it("says when nothing more goes today, instead of „0 today”", () => {
    expect(
      campaignSendNotice(outcomes({ queued: 36 }), queue(36, 0)).text,
    ).toBe(
      "Wysłano do kolejki: 36. Dzisiejszy limit jest już wykorzystany, wysyłka ruszy jutro.",
    );
  });

  it("says how much waits when other campaigns' mail waits too", () => {
    // `waiting` counts every campaign's held mail; „the remaining 156” after
    // a send of 36 would not add up.
    expect(
      campaignSendNotice(outcomes({ queued: 36 }), queue(176, 20)).text,
    ).toBe(
      "Wysłano do kolejki: 36. W kolejce: 176. Dziś wyjdzie jeszcze 20, reszta od jutra.",
    );
  });

  it("is red, and says nothing of the pace, when nobody was queued", () => {
    expect(
      campaignSendNotice(
        outcomes({ duplicate: 4, noConsent: 1 }),
        queue(140, 0),
      ),
    ).toEqual({
      text: "Wysłano do kolejki: 0. Pominięto: 5 - szczegóły w wynikach.",
      color: "error",
    });
  });
});
