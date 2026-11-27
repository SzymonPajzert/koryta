import { describe, it, expect, vi } from "vitest";
import type { Event } from "@sentry/nuxt";
import { withoutPrivateHeaders } from "../../sentry.server.config";

const { init, httpIntegration } = vi.hoisted(() => ({
  init: vi.fn(),
  httpIntegration: vi.fn(() => ({})),
}));
// Hoisted above the import, so the config initialises against this.
vi.mock("@sentry/nuxt", () => ({ init, httpIntegration }));

const READER = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** What the server's Sentry is handed with every event, as configured. */
const options = init.mock.calls[0]![0] as {
  beforeSend: (event: Event) => Event;
  beforeSendTransaction: (event: Event) => Event;
};

describe("sentry.server.config", () => {
  it("sends an error without the reader id a stranger's request carried", () => {
    const event = options.beforeSend({
      request: {
        url: "https://koryta.pl/api/declarations/next?count=3",
        headers: { "x-reader-id": READER, "user-agent": "Firefox" },
      },
    });

    expect(event.request?.headers).toEqual({ "user-agent": "Firefox" });
  });

  it("sends a transaction without it either, in the request or among its spans' attributes", () => {
    const event = options.beforeSendTransaction({
      type: "transaction",
      request: { headers: { "X-Reader-Id": READER } },
      contexts: {
        trace: {
          trace_id: "t",
          span_id: "s",
          data: {
            "http.request.header.x_reader_id": READER,
            "http.request.header.user_agent": "Firefox",
          },
        },
      },
      spans: [
        {
          span_id: "c",
          trace_id: "t",
          start_timestamp: 0,
          data: { "http.request.header.x_reader_id": READER },
        },
      ],
    } as Event);

    expect(JSON.stringify(event)).not.toContain(READER);
    expect(event.contexts?.trace?.data).toEqual({
      "http.request.header.user_agent": "Firefox",
    });
  });

  it("keeps the bodies of the declaration uploads and readings out of an error", () => {
    const { ignoreIncomingRequestBody } = (
      httpIntegration.mock.calls as unknown as [
        { ignoreIncomingRequestBody: (url: string) => boolean },
      ][]
    )[0]![0];

    for (const path of [
      "/api/ingest/declarations",
      "/api/ingest/declarations/employment",
      "/api/declarations/c1/answer",
    ]) {
      expect(ignoreIncomingRequestBody(`https://koryta.pl${path}`)).toBe(true);
    }
    expect(
      ignoreIncomingRequestBody("https://koryta.pl/api/ingest/person"),
    ).toBe(false);
  });

  it("leaves an event with no request alone", () => {
    const event: Event = { message: "boom" };
    expect(withoutPrivateHeaders(event)).toEqual({ message: "boom" });
  });
});
