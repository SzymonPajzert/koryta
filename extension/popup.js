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
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "koryta-job" && message.tabId === tabId) {
    render(message.job);
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
