import { constants, brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);

/** Types where compression buys anything. Everything the app serves in bulk -
 * the SSR html, `_payload.json`, the sitemap - is in here; images, fonts and
 * video are already compressed and only cost cpu to re-do. */
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:json|ld\+json|javascript|xml|xhtml\+xml|rss\+xml|manifest\+json)|image\/svg\+xml)/i;

/** Below this the framing overhead is most of the win and the cpu is wasted.
 * Well under any page this exists for - the smallest is ~450 KB. */
const MIN_BYTES = 1024;

/** What h3 would serialise to JSON itself: a plain object or an array. Not
 * `null` (a 204), and not a class instance - a stream, a web `Response`, or
 * the `H3Error` h3 hands this hook when a handler throws - which h3 sends some
 * other way, or not from the body at all. */
function isJsonBody(body: unknown): body is object {
  if (body === null || typeof body !== "object") return false;
  if (Array.isArray(body)) return true;
  const proto = Object.getPrototypeOf(body);
  return proto === Object.prototype || proto === null;
}

/** Brotli's default is quality 11, which is a text-book choice for a file you
 * compress once at build time and a bad one for a response you compress on
 * every miss: on `/lista`'s 10 MB document it is seconds of a Cloud Run cpu.
 * 4 is the usual dynamic-content setting, within a few percent of 11 on html
 * at a fraction of the time. */
const BROTLI_QUALITY = 4;

/** Neither the Nitro server nor the Envoy in front of it compresses anything,
 * so koryta.pl ships every response raw - 2.2 MB of it on a plain page view,
 * to an audience that is 69% mobile. `compressPublicAssets` in nuxt.config.ts
 * covers what the build emits; this covers what is rendered per request.
 *
 * It hooks `beforeResponse` rather than `render:response` on purpose. The swr
 * route rules cache the *renderer's* output, so compressing there would store
 * one client's encoding in the cache and replay it to everyone - including a
 * client that sent no `Accept-Encoding` at all. `beforeResponse` is the
 * outermost seam, past the cache, and h3 re-reads `response.body` after the
 * hook, so replacing it here is what actually goes out.
 *
 * An api route that returns an object is serialised here, not left to h3.
 * h3 does that after this hook, so there is no body to compress yet - and
 * leaving those alone, on the theory that api responses were small, sent
 * every one of them raw: `/api/nodes?type=place` is 14.4 MB, and the table's
 * requests came to 16.3 MB a visit. It is only done when the result is going to
 * be compressed; otherwise the object goes on to h3 untouched, as before. */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("beforeResponse", async (event, response) => {
    const body = response.body;
    const isBuffer = Buffer.isBuffer(body);
    const isJson = isJsonBody(body);
    if (typeof body !== "string" && !isBuffer && !isJson) return;

    // Only compress what is going out over a socket. A sub-request made with
    // localFetch/$fetch runs through this same hook, and its caller reads the
    // result back in process - so compressing one hands binary to something
    // expecting text. Nitro's error handler does exactly that: it renders the
    // error page by localFetch-ing /__nuxt_error, takes `await res.text()` of
    // the reply, and copies the reply's headers onto the real response. Every
    // byte of the brotli that is not valid utf-8 became U+FFFD in that
    // `text()`, and `content-encoding: br` rode along on a body that was no
    // longer brotli - so the browser could not decode any 404 or 500, and sat
    // there until it gave up. node-mock-http, which backs those in-process
    // requests, leaves `socket` null on its ServerResponse; a real one always
    // has it by the time a body exists. Skipping when it is absent errs the
    // safe way: the cost of a false positive is a response that goes out
    // uncompressed.
    if (!event.node.res.socket) return;

    // Nitro's static handler serves the build's precompressed `.br`/`.gz`
    // siblings itself; re-encoding those would produce nonsense.
    if (getResponseHeader(event, "content-encoding")) return;

    const accepted = String(getRequestHeader(event, "accept-encoding") || "");
    const encoding = /\bbr\b/.test(accepted)
      ? "br"
      : /\bgzip\b/.test(accepted)
        ? "gzip"
        : undefined;

    let raw: Buffer;
    if (isJson) {
      // Serialising only to send it raw would do h3's work twice, so a client
      // that takes no encoding gets the object passed through. It still varies:
      // the size is unknown without serialising, and the next client may take
      // brotli.
      if (!encoding) {
        appendResponseHeader(event, "Vary", "Accept-Encoding");
        return;
      }
      raw = Buffer.from(JSON.stringify(body), "utf8");
    } else {
      const type = String(getResponseHeader(event, "content-type") || "");
      if (!COMPRESSIBLE.test(type)) return;
      raw = isBuffer ? body : Buffer.from(body as string, "utf8");
    }
    if (raw.byteLength < MIN_BYTES) return;

    // Whatever the client can take, the CDN has to key the entry on - it sits
    // in front of us and these responses carry an s-maxage.
    appendResponseHeader(event, "Vary", "Accept-Encoding");
    if (!encoding) return;

    let compressed: Buffer;
    try {
      compressed =
        encoding === "br"
          ? await compressBrotli(raw, {
              params: {
                [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
                [constants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
              },
            })
          : await compressGzip(raw);
    } catch (error) {
      // A response that went out uncompressed is a slow success; one that
      // failed to render is not. Never let this be the reason a page 500s.
      event.captureError?.(error as Error, { tags: ["compression"] });
      return;
    }

    // h3 names the type of what it serialises itself, and sends a buffer as it
    // is - so a body serialised here has to say it is JSON on its own.
    if (isJson && !getResponseHeader(event, "content-type")) {
      setResponseHeader(event, "Content-Type", "application/json");
    }
    setResponseHeader(event, "Content-Encoding", encoding);
    // The stale length is the uncompressed one; h3 sets the right one when it
    // sends the buffer, but only if this is not already sitting on the event.
    removeResponseHeader(event, "Content-Length");
    response.body = compressed;
  });
});
