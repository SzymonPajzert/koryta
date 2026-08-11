/** The facts of the article you are reading, next to the article.
 *
 * A popup is a modal that closes when anything else takes focus, which is a bad
 * home for a job that runs for half a minute and then has a dozen cards to
 * show. So the popup starts a capture and this reports on it — beside the page,
 * for as long as the reader wants it there.
 *
 * It belongs to whichever tab is in front rather than to the one it was opened
 * from: a side panel stays open across tab switches, and a panel still showing
 * the last article's facts over a different page would be worse than showing
 * nothing.
 */

import { getOrigin } from "./config.js";
import { factCard, factWord } from "./facts.js";
import { jobIsBusy, jobMessage } from "./jobs.js";

const el = (id) => document.getElementById(id);

/** Below this the button stays away rather than appearing and refusing.
 *
 * The same floor `/api/ingest/page` enforces. Selecting a few words is what
 * anybody does while reading, so offering to extract from them and then saying
 * no would be a button that is usually a mistake.
 */
const MIN_SELECTION_CHARS = 80;

let tabId = null;
let tabUrl = "";

function setStatus(text, state) {
  el("status").textContent = text;
  el("status").dataset.state = state || "";
}

function renderJob(job) {
  setStatus(jobMessage(job), job?.state);
  const busy = jobIsBusy(job);

  const button = el("capture");
  button.disabled = busy;
  button.textContent = busy ? "Pracuję…" : "Zapisz i wyciągnij fakty";
  // One job per tab, so a run started from either button holds both.
  el("selection-extract").disabled = busy;
}

/** Offers to extract from the passage the reader has highlighted.
 *
 * Driven by what the page reports rather than by anything the panel asks for —
 * see selection.js. An empty or too-short selection takes the offer away again,
 * because the reader has moved on.
 */
function renderSelection(text) {
  const trimmed = (text || "").trim();
  const section = el("selection-section");
  if (trimmed.length < MIN_SELECTION_CHARS) {
    section.hidden = true;
    return;
  }
  el("selection-preview").textContent = trimmed;
  section.hidden = false;
}

/** Scrolls the article to the sentence a fact was read out of.
 *
 * The page has to already have granted `activeTab`, which pressing the toolbar
 * button is what does. A panel opened straight from Chrome's own side-panel
 * menu, on a page nobody has captured, has no such grant — so this says which
 * button to press rather than failing silently.
 */
async function showQuote(quote) {
  const result = await chrome.runtime.sendMessage({
    type: "koryta-show-quote",
    tabId,
    quote,
  });
  if (result?.error) {
    setStatus("Nie mam dostępu do tej strony — otwórz ją przyciskiem Koryta.");
  } else if (!result?.found) {
    // Ordinary rather than broken: `justification` is the model's own wording
    // and need not appear on the page verbatim.
    setStatus("Nie znalazłem tego fragmentu na stronie.");
  } else {
    setStatus("");
  }
}

async function renderFacts({ capture, facts }) {
  const section = el("facts-section");
  const empty = el("empty");

  if (!facts?.length) {
    section.hidden = true;
    empty.hidden = false;
    empty.textContent = capture
      ? "Z tego artykułu nie wyciągnięto jeszcze żadnych faktów."
      : "Ten artykuł nie jest jeszcze zapisany.";
    el("capture").hidden = false;
    return;
  }

  empty.hidden = true;
  el("facts-heading").textContent =
    `${facts.length} ${factWord(facts.length)} z tej strony`;

  const list = el("facts");
  list.replaceChildren();
  for (const fact of facts) {
    list.append(factCard(fact, { onQuote: showQuote }));
  }

  const origin = await getOrigin();
  el("facts-all").href =
    `${origin}/ekstrakcje?article=${encodeURIComponent(capture.url)}`;
  section.hidden = false;
  el("capture").hidden = false;
}

/** Everything the panel shows about one tab, refetched from scratch.
 *
 * Cheap enough to do on every tab switch — one query by url, and a second only
 * when that page turned out to have facts.
 */
async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  tabUrl = tab?.url || "";
  el("page").textContent = tab?.title || "Koryta";

  el("facts-section").hidden = true;
  el("empty").hidden = true;
  el("capture").hidden = true;
  el("selection-section").hidden = true;

  if (!tabId || !/^https?:/.test(tabUrl)) {
    setStatus("Tej strony nie da się zapisać.");
    return;
  }

  renderJob(
    await chrome.runtime.sendMessage({ type: "koryta-job-state", tabId }),
  );

  // Installed once per document; the reply carries whatever is selected right
  // now, so a panel opened over an existing selection sees it too.
  const watched = await chrome.runtime.sendMessage({
    type: "koryta-watch-selection",
    tabId,
  });
  renderSelection(watched?.text);

  const known = await chrome.runtime.sendMessage({
    type: "koryta-known-facts",
    tabId,
    url: tabUrl,
  });
  await renderFacts(known ?? { capture: null, facts: [] });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "koryta-selection") {
    // Sent by the watcher in the page, so the tab it came from is the sender's
    // — and a background tab still reporting its own selection must not move
    // the button under the article in front.
    if (sender?.tab?.id === tabId) renderSelection(message.text);
    return;
  }
  if (message?.type !== "koryta-job" || message.tabId !== tabId) return;
  renderJob(message.job);
  // A capture that has just finished has facts the panel was opened too early
  // to know about.
  if (message.job.state === "done") void load();
});

// A side panel outlives the tab it was opened over, so it has to follow the
// window: both switching tabs and navigating within one leave it pointed at an
// article that is no longer on screen.
chrome.tabs.onActivated.addListener(() => void load());
chrome.tabs.onUpdated.addListener((updatedId, change) => {
  if (updatedId === tabId && change.status === "complete") void load();
});

el("capture").addEventListener("click", async () => {
  renderJob({ state: "capturing" });
  renderJob(
    await chrome.runtime.sendMessage({ type: "koryta-capture", tabId }),
  );
});

el("selection-extract").addEventListener("click", async () => {
  renderJob({ state: "capturing" });
  renderJob(
    await chrome.runtime.sendMessage({
      type: "koryta-capture",
      tabId,
      selectionOnly: true,
    }),
  );
});

void load();
