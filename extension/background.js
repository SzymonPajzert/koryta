/** The extension's one long-lived piece: auth, capture, upload, polling.
 *
 * The popup is a window that opens and closes; anything that has to outlive it
 * lives here. Capturing a page and waiting for its facts takes longer than a
 * popup usually stays open, so the popup asks for a job and then subscribes to
 * whatever this already knows.
 */

import { getOrigin, TOKEN_REFRESH_MARGIN_MS } from "./config.js";
import { collectPage } from "./capture.js";

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
    throw new Error(
      parsed.message || parsed.statusMessage || `HTTP ${response.status}`,
    );
  }
  return parsed;
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

  const token = await requireToken();
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
  try {
    result = await api("/api/ingest/page", {
      method: "POST",
      token: token.token,
      body: {
        url: page.url,
        html: encoded,
        htmlEncoding: "gzip-base64",
        title: page.title,
        publishedDate: page.publishedDate,
        meta: page.ldJson ? { ldJson: page.ldJson } : undefined,
        source: "extension",
      },
    });
  } catch (error) {
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
  return pollCapture(tabId, result.pageId, token.token);
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
