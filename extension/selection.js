/** Telling the panel what the reader has highlighted in the article.
 *
 * The panel cannot see the page's selection, and asking for it on a timer would
 * mean an injection every second for the whole time the panel is open. So this
 * is installed once and the page reports its own changes.
 *
 * Injected by `chrome.scripting.executeScript`, so like `capture.js` it has to
 * be self-contained functions with no imports and JSON-serialisable returns.
 */

/** Installs the reporter, and says what is selected right now.
 *
 * Idempotent: a panel reloads its view on every tab switch and navigation, and
 * a second listener would double every message. The flag lives on `window`,
 * which is per document, so a real navigation correctly gets a fresh one.
 */
export function watchSelection() {
  const current = () => String(window.getSelection?.() ?? "").trim();

  if (!window.__korytaSelectionWatcher) {
    window.__korytaSelectionWatcher = true;

    let timer = 0;
    document.addEventListener("selectionchange", () => {
      // `selectionchange` fires per character as a drag grows. The panel only
      // needs the selection once the reader has stopped making it.
      clearTimeout(timer);
      timer = setTimeout(() => {
        chrome.runtime
          .sendMessage({ type: "koryta-selection", text: current() })
          // Nobody listening is the normal case: the panel is closed far more
          // often than it is open.
          .catch(() => {});
      }, 250);
    });
  }

  return { text: current() };
}
