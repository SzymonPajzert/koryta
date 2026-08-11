import {
  DEFAULT_ORIGIN,
  getOrigin,
  getSidePanelOnCapture,
  setOrigin,
  setSidePanelOnCapture,
} from "./config.js";
import { factConnector, factSubject, factTarget, factWord } from "./facts.js";
import { jobIsBusy, jobMessage } from "./jobs.js";

const el = (id) => document.getElementById(id);
const status = el("status");
const captureButton = el("capture");
const connectButton = el("connect");
const reviewLink = el("review");
const sidePanelToggle = el("side-panel");

let tabId = null;
/** Read once at startup, because `chrome.sidePanel.open` needs the click that
 * is still in progress: awaiting storage inside the handler spends the user
 * gesture, and the call is then refused. */
let sidePanelOnCapture = false;
/** Whether a token is stored at all, which `render` needs and cannot ask for.
 *
 * `showAccount` runs first and would offer the button, then `render` ran second
 * and hid it again for any state but `unauthenticated` — so a freshly installed
 * extension, which has nothing stored and no job yet, showed no way to connect.
 */
let connected = false;

/** One fact on one line: the edge the side panel draws, flattened.
 *
 * The popup is 320px of column, so the three entities are joined rather than
 * laid out — but they are the same three, named by the same helpers, so the two
 * surfaces cannot end up calling the same fact different things.
 */
function factWhat(fact) {
  return [factSubject(fact), factConnector(fact), factTarget(fact)]
    .filter(Boolean)
    .join(" · ");
}

/** Renders the facts already extracted from this page, if there are any.
 *
 * Built with textContent rather than innerHTML: every string here came from a
 * page someone else wrote, by way of a model, and the popup has no business
 * parsing it as markup.
 */
function renderFacts({ capture, facts }, origin) {
  const section = el("facts-section");
  if (!facts?.length) {
    section.hidden = true;
    return;
  }

  el("facts-heading").textContent =
    `${facts.length} ${factWord(facts.length)} z tej strony`;

  const list = el("facts");
  list.replaceChildren();
  for (const fact of facts) {
    const item = document.createElement("li");

    const what = document.createElement("strong");
    what.className = "fact-what";
    what.textContent = factWhat(fact);
    if (fact.reviewed) what.classList.add("fact-reviewed");
    item.append(what);

    const why = document.createElement("span");
    why.className = "fact-why";
    why.textContent = fact.justification || "";
    item.append(why);

    list.append(item);
  }

  el("facts-all").href =
    `${origin}/ekstrakcje?article=${encodeURIComponent(capture.url)}`;
  section.hidden = false;
}

function render(job) {
  status.textContent = jobMessage(job);
  status.dataset.state = job.state;

  const busy = jobIsBusy(job);
  captureButton.disabled = busy;
  captureButton.textContent = busy ? "Pracuję…" : "Zapisz i wyciągnij fakty";
  connectButton.hidden = connected && job.state !== "unauthenticated";
  reviewLink.hidden = job.state !== "done" || !job.facts;
}

async function showAccount() {
  const origin = await getOrigin();
  el("origin").value = origin;
  reviewLink.href = `${origin}/ekstrakcje`;

  const { auth } = await chrome.runtime.sendMessage({
    type: "koryta-auth-state",
  });
  const account = el("account");
  connected = !!auth;
  if (!auth) {
    account.textContent = "niepołączone";
    connectButton.hidden = false;
  } else if (!auth.datascience) {
    // The ingest endpoint refuses these, so say it here rather than after a
    // capture has already been read and compressed.
    account.textContent = `${auth.email} — brak uprawnień`;
  } else {
    account.textContent = auth.email || "połączone";
  }
  if (origin !== DEFAULT_ORIGIN) {
    account.textContent += ` (${new URL(origin).host})`;
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;

  el("page").textContent = tab?.title || "";
  if (!tab || !/^https?:/.test(tab.url || "")) {
    captureButton.disabled = true;
    status.textContent = "Tej strony nie da się zapisać.";
    return;
  }

  sidePanelOnCapture = await getSidePanelOnCapture();
  sidePanelToggle.checked = sidePanelOnCapture;

  await showAccount();
  render(await chrome.runtime.sendMessage({ type: "koryta-job-state", tabId }));

  // Not awaited by the rest of init: this is a round trip to the server, and
  // the capture button must be usable before it comes back.
  void showKnownFacts(tab.url);
}

/** Shows what has already been extracted from this page, when anything has.
 *
 * Deliberately silent when it cannot say: an article nobody has captured is the
 * ordinary case, and a signed-out popup already says so above.
 */
async function showKnownFacts(url) {
  try {
    const known = await chrome.runtime.sendMessage({
      type: "koryta-known-facts",
      tabId,
      url,
    });
    if (known?.facts?.length) renderFacts(known, await getOrigin());
  } catch {
    // The popup closing mid-request rejects sendMessage; nothing to report.
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "koryta-job" && message.tabId === tabId) {
    render(message.job);
    // A capture that just finished has facts the list was opened too early to
    // show, so fetch them rather than making someone reopen the popup.
    if (message.job.state === "done" && message.job.url) {
      void showKnownFacts(message.job.url);
    }
  }
});

captureButton.addEventListener("click", async () => {
  // First, and without an `await` in front of it. Chrome only opens a side
  // panel while a user gesture is live, and every `await` here ends the one
  // that this click provided — so anything asked of storage or the background
  // worker has to happen after the panel is already opening.
  if (sidePanelOnCapture) {
    chrome.sidePanel.open({ tabId }).catch(() => {
      // An older Chrome, or a window that cannot host a panel. The capture is
      // the point and it still runs; the popup goes on reporting it.
    });
  }

  render({ state: "capturing" });
  render(await chrome.runtime.sendMessage({ type: "koryta-capture", tabId }));
});

sidePanelToggle.addEventListener("change", async () => {
  sidePanelOnCapture = sidePanelToggle.checked;
  await setSidePanelOnCapture(sidePanelOnCapture);
});

connectButton.addEventListener("click", async () => {
  status.textContent = "Otwieram koryta.pl…";
  const result = await chrome.runtime.sendMessage({ type: "koryta-connect" });
  status.textContent = result?.error
    ? `Nie udało się połączyć: ${result.error}`
    : "Połączono.";
  await showAccount();
});

el("save-origin").addEventListener("click", async () => {
  try {
    await setOrigin(el("origin").value.trim() || DEFAULT_ORIGIN);
  } catch (error) {
    // Said here rather than left to fail as "Failed to fetch" on the next
    // capture, which is where an unusable address used to show up.
    status.textContent = `Nie zapisano: ${error.message}`;
    return;
  }
  await showAccount();
  status.textContent = "Zapisano adres serwisu.";
});

init();
