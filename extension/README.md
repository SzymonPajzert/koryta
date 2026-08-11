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
still lists the facts, one line each.

The panel follows the front tab, not the tab it was opened over. It needs
Chrome 114 (`chrome.sidePanel`), and it can only scroll a page the extension has
been invoked on — `activeTab` is granted by pressing the toolbar button and
lasts until that tab navigates.

## Against a local dev server

Set the address in the popup's **Ustawienia** to `http://localhost:3000` and run
`devns npm run dev:local`.

`externally_connectable` cannot list `localhost` — Chrome requires a real
second-level domain in those patterns — so the handoff there goes through
`bridge.js`, a content script that relays a `window.postMessage` from
`/rozszerzenie`. Same page, same token, one more hop.

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

## Publishing

Before packing for the store, drop the two localhost entries from
`host_permissions` and the `content_scripts` block from `manifest.json` — they
exist for development and will otherwise widen what reviewers see the extension
asking for. Then set `NUXT_PUBLIC_EXTENSION_ID` on the frontend to the published
id so `/rozszerzenie` knows who to hand tokens to.
