/** The extension's one long-lived piece: auth, capture, upload, polling.
 *
 * The popup is a window that opens and closes; anything that has to outlive it
 * lives here. Capturing a page and waiting for its facts takes longer than a
 * popup usually stays open, so the popup asks for a job and then subscribes to
 * whatever this already knows.
 */

import { getOrigin, TOKEN_REFRESH_MARGIN_MS } from "./config.js";
import { collectPage, readCanonicalUrl } from "./capture.js";
import { scrollToQuote } from "./highlight.js";
import { watchSelection } from "./selection.js";
import { coalesceRefreshes } from "./refresh.js";

/** The most recent job, per tab, so reopening the popup shows where it got to
 * rather than starting again. */
const jobs = new Map();

// --------------------------------------------------------------------------
// Side panel
//
// The panel belongs to the tab it was opened over. Chrome's default is the
// opposite: a panel is a property of the window, so one opened over an article
// stays up over every other tab until somebody closes it by hand — and having
// closed it, the reader has to reopen it on the next article.
//
// Turning off the manifest's global entry is what makes it per-tab: the panel
// then exists only on tabs `popup.js` has enabled it for, so switching away
// takes it off screen and coming back brings it up again, with the facts of
// the article it was opened on.
//
// At the top level rather than in `onInstalled`, because the option lives as
// long as the browser session and not as long as the install — every start of
// the service worker has to assert it again.
// --------------------------------------------------------------------------

chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});

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
  // However this one arrived — a handoff we asked for, or someone opening
  // /rozszerzenie themselves — the site is answering again, so there is nothing
  // left to wait out before the next tab may be opened.
  refreshToken.arrived();
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
 *
 * Never called directly: `refreshToken` is this behind `coalesceRefreshes`, so
 * that six callers wanting a token at the same moment open one tab between them
 * rather than one each.
 */
async function openHandoffTab() {
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

const refreshToken = coalesceRefreshes(openHandoffTab);

async function requireToken(options) {
  return (await readToken()) || (await refreshToken(options));
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

  // No capture means nothing has been extracted, and the second request would
  // be asking the server to confirm an empty answer.
  //
  // A capture that exists but is not finished still gets the second request,
  // though. Facts are filed under the article's url and not under a capture, so
  // once a page has been extracted from a selection, the newest capture of it
  // is routinely one that is still running — and gating on that one's status
  // would hide every fact the run before it had already found.
  const capture = pages.captures?.[0] ?? null;
  if (!capture) return { capture: null, facts: [] };

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

/** Has a tab start reporting what the reader highlights in it.
 *
 * The panel asks for this rather than doing it itself because only the
 * background worker may inject; the messages the watcher then sends go to
 * everything listening, which is where the panel picks them up.
 */
async function watchSelectionIn(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: watchSelection,
  });
  return injection?.result ?? { text: "" };
}

/** Scrolls a tab to the passage a fact was read out of.
 *
 * The injection needs an `activeTab` grant on that tab, which pressing the
 * toolbar button is what gives us and which lasts until the tab navigates. A
 * panel opened from Chrome's own side-panel menu, over a page the extension has
 * never been invoked on, has no grant — so the failure is reported rather than
 * thrown, and the panel names the button to press.
 */
async function showQuote(tabId, quote) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: scrollToQuote,
    args: [String(quote ?? "")],
  });
  return injection?.result ?? { found: false };
}

function setJob(tabId, job) {
  jobs.set(tabId, job);
  // The popup may be closed; nobody listening is the normal case.
  chrome.runtime
    .sendMessage({ type: "koryta-job", tabId, job })
    .catch(() => {});
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
      // An extraction that never started is not a capture that failed. The
      // page is in the archive, the article node exists, and the nightly
      // pipeline reads the bucket regardless — so the only thing missing is
      // the preview, and saying "nie udało się" about the whole thing is
      // wrong.
      //
      // Told apart by `startedAt`, which the service writes before it reads
      // anything: its absence means nothing ever picked the job up, whether
      // because the frontend could not dispatch it or because the service
      // refused the work as misconfigured. Both are somebody's deployment,
      // neither is this capture.
      return setJob(tabId, {
        state: capture.extraction?.startedAt ? "error" : "stored",
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

/** How much has to be highlighted before a capture carries the selection along.
 *
 * Nobody asked for this one — it is a reader who happened to have something
 * selected when they pressed the save button, so it has to be enough text to be
 * unambiguously the article body rather than a headline they double-clicked.
 */
const INCIDENTAL_SELECTION_CHARS = 200;

/** And when the reader asked for exactly this passage.
 *
 * Lower, because the intent is not in doubt — but not absent: a few words give
 * the facts prompt nothing to ground a claim in, and the run costs what a real
 * one costs. `/api/ingest/page` refuses anything shorter too; this is here so
 * the answer comes back before the page has been read and compressed.
 */
const MIN_SELECTION_CHARS = 80;

/** Captures the page in a tab, and asks for its facts.
 *
 * `selectionOnly` is the reader saying which paragraph to read: the whole page
 * is still archived, and the selection rides along to be what the extractor
 * parses instead of whatever a selector would have found. It is how a second
 * pass over an article is asked for when the first missed something.
 */
async function captureTab(tabId, { selectionOnly = false } = {}) {
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

  const highlighted = (page.selection || "").trim();
  const floor = selectionOnly
    ? MIN_SELECTION_CHARS
    : INCIDENTAL_SELECTION_CHARS;
  const selection = highlighted.length >= floor ? highlighted : "";
  if (selectionOnly && !selection) {
    return setJob(tabId, {
      state: "error",
      error: `zaznacz co najmniej ${MIN_SELECTION_CHARS} znaków`,
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
          selection: selection || undefined,
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

  // The server already knows this one and there is nothing to wait for, so it
  // is said now rather than three seconds into a poll that will only find the
  // same thing. `pollCapture` reaches the same verdict for a page whose earlier
  // capture was left this way.
  if (result.dispatched === false) {
    return setJob(tabId, {
      state: "stored",
      pageId: result.pageId,
      error: result.dispatchError,
      url: page.url,
    });
  }

  setJob(tabId, { state: "extracting", pageId: result.pageId, url: page.url });
  return pollCapture(tabId, result.pageId, auth.token);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "koryta-capture") {
    captureTab(message.tabId, { selectionOnly: !!message.selectionOnly })
      .catch((error) =>
        setJob(message.tabId, { state: "error", error: error.message }),
      )
      .then(sendResponse);
    return true;
  }
  if (message?.type === "koryta-watch-selection") {
    watchSelectionIn(message.tabId)
      .then(sendResponse)
      // A page with no `activeTab` grant cannot be watched, which only means
      // the panel offers no selection button until the page is captured.
      .catch(() => sendResponse({ text: "" }));
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
      .catch((error) =>
        sendResponse({ capture: null, facts: [], error: error.message }),
      );
    return true;
  }
  if (message?.type === "koryta-show-quote") {
    showQuote(message.tabId, message.quote)
      .then(sendResponse)
      .catch((error) => sendResponse({ found: false, error: error.message }));
    return true;
  }
  if (message?.type === "koryta-auth-state") {
    readToken().then((auth) => sendResponse({ auth }));
    return true;
  }
  if (message?.type === "koryta-connect") {
    // Forced past the cooldown: somebody pressed this, which usually means
    // they have just signed in and know something the last failure did not.
    refreshToken({ force: true })
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
