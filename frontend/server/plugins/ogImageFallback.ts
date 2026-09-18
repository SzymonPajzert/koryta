/** Turns a failed social-card render into the static card rather than a page of
 * html.
 *
 * When `/_og/**` fails, nitro answers with its rendered error page - ~57 KB of
 * html under an image URL. Facebook, LinkedIn and Slack all cache what they
 * scraped, failures included, for days: one bad render is a broken preview on
 * every share of that page until their cache turns, and there is nothing on
 * this end that can flush it. A 302 to `/social-card.png` degrades to exactly
 * what the site showed before this feature existed.
 *
 * The card itself is text and rectangles - no <img>, no external fetch, no
 * emoji - so there is little left to fail. This is for what is left: a signature
 * rejected because the secret moved, a prop shape that changed under a URL
 * somebody shared last month, an OOM in resvg. The module's own `renderTimeout`
 * cannot cover those - it is a `Promise.race`, and `resvg.render()` is
 * synchronous native code, so the timer cannot fire while it runs.
 *
 * Five minutes, not three days: a failure should be re-tried soon after it is
 * fixed, while a success is worth caching for as long as the CDN will hold it.
 *
 * `beforeResponse` is the same seam `compression.ts` uses, and for the same
 * reason - it is outermost, past the route cache, and h3 re-reads the response
 * after the hook.
 */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("beforeResponse", (event, response) => {
    if (!event.path?.startsWith("/_og/")) return;

    // Only rewrite what is going out over a socket. Nitro renders its error
    // page by localFetch-ing /__nuxt_error in process, and node-mock-http leaves
    // `socket` null on those - redirecting one would answer the renderer rather
    // than the reader. compression.ts documents the same trap at length.
    if (!event.node.res.socket) return;

    // Where the status actually lives at this point in the request.
    //
    // Not on the response: h3 runs this hook on its error path with
    // `{ body: error }` and applies the code to the socket afterwards, so
    // `res.statusCode` still reads 200 for a request that is about to answer
    // 403. Reading it from there is how the first version of this plugin
    // managed to run on every failure and convert none of them.
    const body = response?.body as { statusCode?: unknown } | undefined;
    const status =
      body && typeof body === "object" && typeof body.statusCode === "number"
        ? body.statusCode
        : event.node.res.statusCode;
    if (status < 400) return;

    event.node.res.statusCode = 302;
    event.node.res.setHeader("location", "/social-card.png");
    // Five minutes, not the three days the module puts on a card. A failure
    // should be retried soon after it is fixed; the module's own headers are
    // already on the response by now and would otherwise cache a 403 until
    // Thursday.
    event.node.res.setHeader("cache-control", "public, max-age=300");
    event.node.res.removeHeader("content-type");
    event.node.res.removeHeader("content-length");
    response.body = "";
    // Ending it here is the whole trick. h3 runs this hook on its error path as
    // well as its success path, but follows it with `sendError`, which resets
    // the status and writes a json body over the top - and the only thing that
    // stops it is `event.handled`, which is `res.writableEnded ||
    // res.headersSent`. Setting headers without ending the response leaves the
    // 403 exactly as it was, which is how this was first written and why the
    // first end-to-end check still saw one.
    event.node.res.end();
  });
});
