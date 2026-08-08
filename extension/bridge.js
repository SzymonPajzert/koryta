/** Token relay for a local dev server.
 *
 * `externally_connectable` patterns have to name a real domain — Chrome rejects
 * `http://localhost/*` — so a page served from `npm run dev:local` cannot call
 * `chrome.runtime.sendMessage` at the extension the way koryta.pl can. A
 * content script can, and content scripts do run on localhost, so `/rozszerzenie`
 * falls back to `window.postMessage` and this forwards it.
 *
 * Same-window messages only, and only the one message type: a page can post
 * whatever it likes into its own window, and the only thing being trusted here
 * is a token that is checked by Firebase on the other end anyway.
 */
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "koryta-token") return;

  chrome.runtime
    .sendMessage({
      type: "koryta-token",
      token: event.data.token,
      expiresAt: event.data.expiresAt,
      email: event.data.email,
      uid: event.data.uid,
      datascience: event.data.datascience,
    })
    .then(() => window.postMessage({ type: "koryta-token-ack" }, "*"))
    .catch(() => {});
});

// Tells the page an extension is installed, so /rozszerzenie can say so.
window.postMessage(
  { type: "koryta-extension-present", version: chrome.runtime.getManifest().version },
  "*",
);
