/** The extension's one long-lived piece: auth, capture, upload, polling.
 *
 * The popup is a window that opens and closes; anything that has to outlive it
 * lives here. Capturing a page and waiting for its facts takes longer than a
 * popup usually stays open, so the popup asks for a job and then subscribes to
 * whatever this already knows.
 */

import { getOrigin, TOKEN_REFRESH_MARGIN_MS } from "./config.js";
import { collectPage, readCanonicalUrl } from "./capture.js";

/** The most recent job, per tab, so reopening the popup shows where it got to
 * rather than starting again. */
const jobs = new Map();

// --------------------------------------------------------------------------
// Authentication
//
// koryta.pl signs people in with Firebase, whose session lives in the site's
// own storage and is not reachable from here. So the site hands a token over
// instead: /rozszerzenie posts one with chrome.runtime.sendMessage, which the
// manifest's `externally_connectable` allows it to do.
// --------------------------------------------------------------------------

/** Anyone currently waiting for a token to arrive.
 *
 * A token reaches us two ways — `onMessageExternal` from koryta.pl, or relayed
 * by bridge.js from a localhost dev server, which `externally_connectable`
 * refuses to accept messages from because its patterns require a real domain.
 * Both end up here so `refreshToken` does not have to care which it was.
 */
const tokenWaiters = new Set();

async function storeToken(payload) {
  if (!payload?.token) return { ok: false, error: "no token" };
  const auth = {
    token: payload.token,
    // Firebase id tokens last an hour. Trusting the site's number rather than
    // decoding the token keeps this from having to parse a JWT.
    expiresAt: payload.expiresAt || Date.now() + 3600_000,
    email: payload.email || "",
    uid: payload.uid || "",
    datascience: !!payload.datascience,
  };
  await chrome.storage.local.set({ auth });
  for (const waiter of [...tokenWaiters]) waiter(auth);
  return { ok: true, datascience: auth.datascience };
}

async function readToken() {
  const { auth } = await chrome.storage.local.get("auth");
  if (!auth?.token) return null;
  if (auth.expiresAt - TOKEN_REFRESH_MARGIN_MS < Date.now()) return null;
  return auth;
}

/** Gets a fresh token by opening the handoff page out of sight.
 *
 * The tab has to exist — an id token can only be minted by a page with the
 * Firebase session — but it does not have to be looked at. If the person is
 * signed out the page cannot answer, so this gives up after a while and the
 * popup asks them to connect by hand.
 */
async function refreshToken() {
  const origin = await getOrigin();
  const tab = await chrome.tabs.create({
    url: `${origin}/rozszerzenie?silent=1`,
    active: false,
  });

  let waiter;
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        tokenWaiters.delete(waiter);
        reject(new Error("nie udało się odświeżyć sesji"));
      }, 20_000);
      waiter = (auth) => {
        clearTimeout(timer);
        tokenWaiters.delete(waiter);
        resolve(auth);
      };
      tokenWaiters.add(waiter);
    });
  } finally {
    tokenWaiters.delete(waiter);
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function requireToken() {
  return (await readToken()) || (await refreshToken());
}

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === "koryta-token") {
    storeToken(message).then(sendResponse);
    return true;
  }
  if (message?.type === "koryta-ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
  }
  return false;
});

// --------------------------------------------------------------------------
// Capture
// --------------------------------------------------------------------------

/** gzip, then base64 in chunks.
 *
 * A rendered news page is a couple of megabytes of mostly markup and inline
 * script, which gzip takes down by an order of magnitude — worth doing before
 * putting it in a JSON body. The chunking is not an optimisation: spreading a
 * multi-megabyte array into `String.fromCharCode` overflows the stack.
 */
async function gzipBase64(text) {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());

  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return { encoded: btoa(binary), rawBytes: bytes.length };
}

async function api(path, { method = "GET", body, token }) {
  const origin = await getOrigin();
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { message: text.slice(0, 200) };
  }
  if (!response.ok) {
    const error = new Error(
      parsed.message || parsed.statusMessage || `HTTP ${response.status}`,
    );
    // Carried so the caller can tell "the server said no" from "the request
    // never arrived", which is the difference between re-minting a token and
    // showing the person an error.
    error.status = response.status;
    throw error;
  }
  return parsed;
}

/** Runs a request, and mints a new token if the server refuses the one it has.
 *
 * A cached token can be unexpired and still be refused. The usual cause is the
 * dev server changing Firebase project underneath it — `dev:local` issues
 * tokens for `demo-koryta-pl` and `dev:prod-data` for `koryta-pl`, and an id
 * token names the project it was issued for. Re-seeding the auth emulator does
 * the same thing.
 *
 * Without this the extension serves that dead token for the rest of its hour,
 * and the popup hides the button that would fix it because something is stored.
 */
async function withToken(run) {
  let auth = await requireToken();
  try {
    return { result: await run(auth.token), auth };
  } catch (error) {
    if (error.status !== 401) throw error;
    await chrome.storage.local.remove("auth");
    auth = await requireToken();
    return { result: await run(auth.token), auth };
  }
}

/** What is already known about the page someone is looking at.
 *
 * Opening the popup on an article should answer "have we read this, and what
 * came out of it" without capturing it again — most of the time the answer is
 * that nothing has, which is why this stays quiet rather than reporting an
 * error when there is no capture.
 *
 * Looked up by url rather than by the job map: jobs live only as long as the
 * service worker, and the interesting case is an article captured last week.
 */
async function knownFacts(tabId, tabUrl) {
  // Asked about the canonical url, because that is what a capture is filed
  // under. `normalizeUrl` forgives the scheme, `www.` and a trailing slash, but
  // it keeps the query string deliberately — for some Polish sites that is the
  // article id — so an address carrying campaign parameters really is a
  // different key, and only the page itself can say which url it claims to be.
  let url = tabUrl;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readCanonicalUrl,
    });
    if (injection?.result) url = injection.result;
  } catch {
    // No activeTab grant on this page; the address bar is the best guess left.
  }

  const { result: pages } = await withToken((token) =>
    api(`/api/pages?limit=1&url=${encodeURIComponent(url)}`, { token }),
  );

  const capture = pages.captures?.[0] ?? null;
  if (!capture || capture.status !== "done" || !capture.extraction?.factCount) {
    return { capture, facts: [] };
  }

  // Keyed on the capture's own url, not the tab's: the two differ whenever the
  // page names a canonical link, and the facts were filed under the former.
  const { result } = await withToken((token) =>
    api(
      `/api/extractions?limit=50&articleUrl=${encodeURIComponent(capture.url)}`,
      { token },
    ),
  );
  return { capture, facts: result.facts ?? [] };
}

function setJob(tabId, job) {
  jobs.set(tabId, job);
  // The popup may be closed; nobody listening is the normal case.
  chrome.runtime.sendMessage({ type: "koryta-job", tabId, job }).catch(() => {});
  return job;
}

/** Watches a capture until the extractor is finished with it.
 *
 * Polling rather than anything cleverer because the answer arrives in tens of
 * seconds and the alternative is a websocket nobody else needs.
 */
async function pollCapture(tabId, pageId, token) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    let capture;
    try {
      ({ capture } = await api(`/api/pages/${pageId}`, { token }));
    } catch {
      continue; // A blip while the extractor works is not a failure.
    }

    if (capture.status === "done") {
      return setJob(tabId, {
        state: "done",
        pageId,
        facts: capture.extraction?.factCount ?? 0,
        score: capture.extraction?.koryciarskiScore ?? null,
        url: capture.url,
      });
    }
    if (capture.status === "error") {
      return setJob(tabId, {
        state: "error",
        pageId,
        error: capture.extraction?.error || "ekstrakcja nie powiodła się",
        url: capture.url,
      });
    }
    setJob(tabId, { state: "extracting", pageId, url: capture.url });
  }

  return setJob(tabId, {
    state: "slow",
    pageId,
    message: "Strona jest zapisana — ekstrakcja trwa dłużej niż zwykle.",
  });
}

async function captureTab(tabId) {
  setJob(tabId, { state: "capturing" });

  // Checked before the page is read and compressed, so a signed-out person is
  // told to connect rather than made to wait for work that cannot be submitted.
  let token;
  try {
    token = await requireToken();
  } catch {
    return setJob(tabId, { state: "unauthenticated" });
  }
  if (!token) {
    return setJob(tabId, { state: "unauthenticated" });
  }

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectPage,
  });
  const page = injection?.result;
  if (!page?.html) {
    return setJob(tabId, {
      state: "error",
      error: "nie udało się odczytać tej strony",
    });
  }

  setJob(tabId, { state: "uploading", url: page.url, title: page.title });
  const { encoded } = await gzipBase64(page.html);

  let result;
  let auth = token;
  try {
    ({ result, auth } = await withToken((bearer) =>
      api("/api/ingest/page", {
        method: "POST",
        token: bearer,
        body: {
          url: page.url,
          html: encoded,
          htmlEncoding: "gzip-base64",
          title: page.title,
          publishedDate: page.publishedDate,
          meta: page.ldJson ? { ldJson: page.ldJson } : undefined,
          source: "extension",
        },
      }),
    ));
  } catch (error) {
    // A 401 that survived a freshly minted token is a session that cannot be
    // repaired from here, so offer to connect. A 403 is not: that account is
    // signed in and simply not in the datascience group, and telling them to
    // log in again would send them round in circles — the server's own message
    // says what is actually wrong.
    if (error.status === 401) {
      return setJob(tabId, { state: "unauthenticated" });
    }
    return setJob(tabId, { state: "error", error: error.message });
  }

  if (result.duplicate && result.captureStatus === "done") {
    return setJob(tabId, {
      state: "done",
      pageId: result.pageId,
      duplicate: true,
      url: page.url,
    });
  }

  setJob(tabId, { state: "extracting", pageId: result.pageId, url: page.url });
  return pollCapture(tabId, result.pageId, auth.token);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "koryta-capture") {
    captureTab(message.tabId)
      .catch((error) =>
        setJob(message.tabId, { state: "error", error: error.message }),
      )
      .then(sendResponse);
    return true;
  }
  if (message?.type === "koryta-job-state") {
    sendResponse(jobs.get(message.tabId) || { state: "idle" });
    return false;
  }
  if (message?.type === "koryta-known-facts") {
    knownFacts(message.tabId, message.url)
      // Never rejects at the popup: not knowing yet is the ordinary state, and
      // an error here must not stand between someone and the capture button.
      .then(sendResponse)
      .catch((error) => sendResponse({ capture: null, facts: [], error: error.message }));
    return true;
  }
  if (message?.type === "koryta-auth-state") {
    readToken().then((auth) => sendResponse({ auth }));
    return true;
  }
  if (message?.type === "koryta-connect") {
    refreshToken()
      .then((auth) => sendResponse({ auth }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  // Relayed by bridge.js from a localhost dev server, which
  // `externally_connectable` will not accept a message from directly.
  if (message?.type === "koryta-token") {
    storeToken(message).then(sendResponse);
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => jobs.delete(tabId));
