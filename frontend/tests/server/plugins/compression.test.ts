import { describe, expect, it, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import * as h3 from "h3";
import type { H3Event } from "h3";
import plugin from "../../../server/plugins/compression";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineNitroPlugin = (fn: any) => fn;
});

// The Nitro auto-imports the hook calls, as the real h3 helpers. Only read
// once a response is on its way, so they need not be there at import time.
Object.assign(globalThis, {
  getRequestHeader: h3.getRequestHeader,
  getResponseHeader: h3.getResponseHeader,
  setResponseHeader: h3.setResponseHeader,
  appendResponseHeader: h3.appendResponseHeader,
  removeResponseHeader: h3.removeResponseHeader,
});

type Hook = (event: H3Event, response: { body?: unknown }) => Promise<void>;
let beforeResponse: Hook | undefined;
(plugin as unknown as (nitro: unknown) => void)({
  hooks: {
    hook: (name: string, fn: Hook) => {
      if (name === "beforeResponse") beforeResponse = fn;
    },
  },
});

/** A request as it arrives over a socket, or - `socket: false` - as a
 * localFetch sub-request, whose response has none. */
function makeEvent(
  headers: Record<string, string> = {},
  { socket = true } = {},
): H3Event {
  const req = new IncomingMessage(new Socket());
  req.headers = headers;
  const res = new ServerResponse(req);
  if (socket) res.assignSocket(new Socket());
  return h3.createEvent(req, res);
}

/** An api response the size of a real one, not of a unit test's. */
const nodes = Object.fromEntries(
  Array.from({ length: 200 }, (_, i) => [
    `node-${i}`,
    { id: `node-${i}`, name: `Spółka Testowa ${i}`, type: "place" },
  ]),
);

async function respond(event: H3Event, body: unknown) {
  const response = { body };
  await beforeResponse!(event, response);
  return response.body;
}

describe("compression", () => {
  it("compresses an object an api route returned", async () => {
    const event = makeEvent({ "accept-encoding": "gzip, deflate, br" });
    const body = await respond(event, { nodes });

    expect(Buffer.isBuffer(body)).toBe(true);
    expect(JSON.parse(brotliDecompressSync(body as Buffer).toString())).toEqual(
      { nodes },
    );
    const headers = event.node.res.getHeaders();
    expect(headers["content-encoding"]).toBe("br");
    // h3 would have named the type; a buffer it sends as it is.
    expect(headers["content-type"]).toBe("application/json");
    expect(String(headers.vary)).toContain("Accept-Encoding");
  });

  it("compresses an array with gzip when that is all the client takes", async () => {
    const event = makeEvent({ "accept-encoding": "gzip" });
    const body = await respond(event, Object.values(nodes));

    expect(JSON.parse(gunzipSync(body as Buffer).toString())).toEqual(
      Object.values(nodes),
    );
    expect(event.node.res.getHeader("content-encoding")).toBe("gzip");
  });

  it("keeps a content type the route set itself", async () => {
    const event = makeEvent({ "accept-encoding": "br" });
    event.node.res.setHeader("content-type", "application/ld+json");
    await respond(event, { nodes });
    expect(event.node.res.getHeader("content-type")).toBe(
      "application/ld+json",
    );
  });

  it("hands the object on to h3 for a client that takes no encoding", async () => {
    const event = makeEvent();
    const payload = { nodes };
    expect(await respond(event, payload)).toBe(payload);
    expect(event.node.res.getHeader("content-encoding")).toBeUndefined();
    // Still keyed on the encoding: the next client may take brotli.
    expect(String(event.node.res.getHeader("vary"))).toContain(
      "Accept-Encoding",
    );
  });

  it("leaves a small object alone", async () => {
    const event = makeEvent({ "accept-encoding": "br" });
    const payload = { ok: true };
    expect(await respond(event, payload)).toBe(payload);
    expect(event.node.res.getHeader("content-encoding")).toBeUndefined();
  });

  // SSR's $fetch reads the reply back in process, and binary is not what it
  // expects - the reason the socket check exists at all.
  it("leaves an in-process sub-request alone", async () => {
    const event = makeEvent({ "accept-encoding": "br" }, { socket: false });
    const payload = { nodes };
    expect(await respond(event, payload)).toBe(payload);
    expect(event.node.res.getHeader("content-encoding")).toBeUndefined();
  });

  it("leaves what h3 does not serialise as JSON alone", async () => {
    const event = makeEvent({ "accept-encoding": "br" });
    const error = h3.createError({ statusCode: 500, data: { nodes } });
    expect(await respond(event, error)).toBe(error);
    expect(await respond(event, null)).toBeNull();
    expect(event.node.res.getHeader("content-encoding")).toBeUndefined();
  });

  it("still compresses a rendered page", async () => {
    const event = makeEvent({ "accept-encoding": "br" });
    event.node.res.setHeader("content-type", "text/html;charset=utf-8");
    const html = `<html>${"<p>koryto</p>".repeat(200)}</html>`;
    const body = await respond(event, html);
    expect(brotliDecompressSync(body as Buffer).toString()).toBe(html);
    expect(event.node.res.getHeader("content-type")).toBe(
      "text/html;charset=utf-8",
    );
  });
});
