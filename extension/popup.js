import { DEFAULT_ORIGIN, getOrigin, setOrigin } from "./config.js";

const el = (id) => document.getElementById(id);
const status = el("status");
const captureButton = el("capture");
const connectButton = el("connect");
const reviewLink = el("review");

let tabId = null;
/** Whether a token is stored at all, which `render` needs and cannot ask for.
 *
 * `showAccount` runs first and would offer the button, then `render` ran second
 * and hid it again for any state but `unauthenticated` — so a freshly installed
 * extension, which has nothing stored and no job yet, showed no way to connect.
 */
let connected = false;

/** Every state the background worker can be in, said in Polish.
 *
 * Kept as one table rather than scattered through the flow so the popup never
 * ends up with a state it silently renders as blank.
 */
const MESSAGES = {
  idle: () => "",
  capturing: () => "Odczytuję stronę…",
  uploading: () => "Wysyłam do archiwum…",
  extracting: () => "Wyciągam fakty — to potrwa kilkanaście sekund…",
  unauthenticated: () =>
    "Zaloguj się na koryta.pl i połącz rozszerzenie, żeby zapisywać artykuły.",
  slow: (job) => job.message,
  done: (job) =>
    job.duplicate
      ? "Ten artykuł był już zapisany."
      : job.facts
        ? `Gotowe — ${job.facts} ${factWord(job.facts)} do przejrzenia.`
        : "Zapisane. Nie znaleziono w tym artykule faktów do dodania.",
  error: (job) => `Nie udało się: ${job.error}`,
};

/** One fact, said the way the ingest schema stores it.
 *
 * The three shapes are the three `fact_type`s the endpoint accepts; anything
 * else falls back to the model's own justification, which is never empty.
 */
function factWhat(fact) {
  switch (fact.fact_type) {
    case "employment":
      return [fact.person, fact.role, fact.organization]
        .filter(Boolean)
        .join(" · ");
    case "party_membership":
      return [fact.person, fact.party].filter(Boolean).join(" · ");
    case "personal_relation":
      return [fact.subject, fact.relation, fact.object]
        .filter(Boolean)
        .join(" · ");
    default:
      return fact.justification || "";
  }
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

function factWord(count) {
  if (count === 1) return "fakt";
  const rest = count % 10;
  const teens = count % 100;
  return rest >= 2 && rest <= 4 && (teens < 12 || teens > 14) ? "fakty" : "faktów";
}

function render(job) {
  const message = MESSAGES[job.state] || (() => "");
  status.textContent = message(job) || "";
  status.dataset.state = job.state;

  const busy = ["capturing", "uploading", "extracting"].includes(job.state);
  captureButton.disabled = busy;
  captureButton.textContent = busy ? "Pracuję…" : "Zapisz i wyciągnij fakty";
  connectButton.hidden = connected && job.state !== "unauthenticated";
  reviewLink.hidden = job.state !== "done" || !job.facts;
}

async function showAccount() {
  const origin = await getOrigin();
  el("origin").value = origin;
  reviewLink.href = `${origin}/ekstrakcje`;

  const { auth } = await chrome.runtime.sendMessage({ type: "koryta-auth-state" });
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
  render({ state: "capturing" });
  render(await chrome.runtime.sendMessage({ type: "koryta-capture", tabId }));
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
