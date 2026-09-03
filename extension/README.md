# Koryta — zapisz artykuł

A Chrome extension that takes the article you are reading, files it in the
crawled bucket, and asks the extractor for its facts.

## Why an extension

The crawler fetches anonymously, so a paywalled article gives it a teaser and
nothing else — and those are exactly the articles worth reading, because they
are the ones with reporting behind them. A reader who is logged in already has
the whole thing rendered in their browser. This ships that DOM.

The alternatives were weighed and lost:

- **a bookmarklet** cannot attach a Firebase token, and most news sites' CSP
  blocks it from posting anywhere;
- **"save as html and upload"** works and is [built into `/zrodla`](../frontend/app/pages/zrodla.vue)
  as a fallback, but loses the canonical url and takes half a minute per
  article;
- **server-side headless login** would mean holding subscribers' credentials,
  which is not a thing to build.

## Installing it (unpacked)

1. `chrome://extensions` → Developer mode → Load unpacked → pick this folder.
2. Sign in at koryta.pl, then open the popup and press **Połącz z koryta.pl**.
   It opens `/rozszerzenie`, which hands over a Firebase id token.
3. Open an article and press **Zapisz i wyciągnij fakty**.

You need the `datascience` claim — the same one `/ekstrakcje` requires. The
popup says so up front rather than after uploading a page.

## The side panel

Saving opens a panel beside the article, which is where the capture reports and
where its facts arrive as cards — the same edge the site draws at `/ekstrakcje`,
subject ── connector ──▶ target over the sentence it was read from. A popup
closes the moment the page is clicked, and an extraction takes half a minute, so
without the panel the usual outcome was that nobody saw how it went.

Clicking a card's quote scrolls the article to that passage and highlights it,
rather than opening the article again at a `#:~:text=` fragment the way the site
does — here the article is already on screen. The find is whitespace- and
quote-insensitive and falls back to the opening words, because a `justification`
is the model's own wording and need not appear on the page verbatim.

Turn it off in **Ustawienia** if you would rather keep the column: the popup
still lists the facts, one line each. The cross in the panel's own top right
closes it — Chrome puts no window furniture around a side panel, and the
`chrome.sidePanel` API can open one but not close one, so the panel calls
`window.close()` on itself.

The panel belongs to the tab it was opened over. Chrome's own default is a
panel that belongs to the window: it stays up over every other tab until
somebody closes it, and then has to be reopened on the next article. So the
manifest's global entry is disabled and the popup enables the panel on one tab
at a time — switching tabs takes it off screen, coming back brings it up again
still showing that article's facts, and closing a tab takes its panel with it.

It needs Chrome 114 (`chrome.sidePanel`), and it can only scroll a page the
extension has been invoked on — `activeTab` is granted by pressing the toolbar
button and lasts until that tab navigates.

## Against a local dev server

Set the address in the popup's **Ustawienia** to `http://localhost:3000` and run
`devns npm run dev:local`.

`externally_connectable` cannot list `localhost` — Chrome requires a real
second-level domain in those patterns — so the handoff there goes through
`bridge.js`, a content script that relays a `window.postMessage` from
`/rozszerzenie`. Same page, same token, one more hop.

Restarting the dev server invalidates every token the extension holds — an id
token names the Firebase project it was issued for, and re-seeding the auth
emulator is enough. The extension notices by way of a 401 and re-mints, which
means opening `/rozszerzenie` in a tab; `refresh.js` is what keeps that one tab
rather than one per asker, and leaves the site alone for a minute after a
handoff that failed. **Połącz z koryta.pl** skips that wait.

A dev server has no extractor behind it unless you start one, so a capture there
usually ends at **"Zapisane w archiwum — ekstrakcja nie wystartowała"**. That is
not a failed capture: the html is in `$TMPDIR/koryta-captures`, the article node
exists, and the nightly pipeline reads the archive regardless. Only the preview
is missing. [`src/service/README.md`](../data/pipelines/src/service/README.md#running-it-locally)
has the two commands that give you one.

## What it sends

`document.documentElement.outerHTML`, gzipped, plus the canonical url, the
title, and `datePublished` from ld+json where the page has it.

Nothing is sent until you press the button: the extension asks for `activeTab`
rather than permission to read every site, so it can only see a page you have
explicitly handed it.

## Extracting from a passage

Select a paragraph and the panel offers **Wyciągnij fakty z zaznaczenia**. The
whole page is archived as usual; the selection rides along and becomes what the
extractor parses, in place of whatever CSS selector it would otherwise have
guessed with (`content_override` in `scrapers.article.oneshot`).

Two things it is for: a domain nobody has a learned selector for yet, where the
parse comes back with a nav bar, and a run over the whole article that missed a
fact plainly sitting in one paragraph. Either way you are looking at the page,
which no selector is.

A selection is part of what makes a capture unique, so the same article can be
extracted from more than once — but the same passage twice is still a duplicate
and costs nothing. The bytes are only uploaded once; a second run points at the
archive already in the bucket.

Selecting more than 200 characters and pressing the ordinary save button sends
that selection too, on the same reasoning. Below 80 characters nothing is sent
either way: that is not enough for the facts prompt to ground a claim in, and
the run costs what a real one costs.

## Its id, and why the manifest carries a key

`/rozszerzenie` has to name the extension it hands a token to, and Chrome
normally derives an unpacked extension's id from the absolute path it was loaded
from — a different id on every machine, which is not something a deployed
frontend can be told in advance.

So `manifest.json` carries a `key`: the public half of an RSA keypair, from
which Chrome computes the id instead. That id is
`ppgedfpjafcklogippkoheikkalkehbb`, it is the same everywhere, and it is what
`NUXT_PUBLIC_EXTENSION_ID` is set to in `frontend/apphosting.yaml`.

The private half lives at `~/.config/koryta/extension-key.pem` and is not in the
repo. Nothing needs it today — it is only for signing a `.crx` if these are ever
self-hosted rather than listed.

## Publishing

Before packing for the store, drop the two localhost entries from
`host_permissions` and the `content_scripts` block from `manifest.json` — they
exist for development and will otherwise widen what reviewers see the extension
asking for.

The store assigns an id from a key of its own, which will not be the one above.
So after the first upload, replace `key` with the public key from the listing and
update `NUXT_PUBLIC_EXTENSION_ID` to match — that is what keeps a locally loaded
copy and the published one sharing an id, and what the field is conventionally
for. Until then the self-generated key is what makes the deployed origins work
at all.

`https://*.koryta.pl/*` is in `host_permissions` for `autopush.koryta.pl`, the
staging backend. It stays after publishing: `externally_connectable` already
matches the same pattern, so removing one without the other would leave the
token handoff working on a subdomain the capture upload could not reach.
