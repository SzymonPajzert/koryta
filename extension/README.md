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

## Against a local dev server

Set the address in the popup's **Ustawienia** to `http://localhost:3000` and run
`devns npm run dev:local`.

`externally_connectable` cannot list `localhost` — Chrome requires a real
second-level domain in those patterns — so the handoff there goes through
`bridge.js`, a content script that relays a `window.postMessage` from
`/rozszerzenie`. Same page, same token, one more hop.

## What it sends

`document.documentElement.outerHTML`, gzipped, plus the canonical url, the
title, and `datePublished` from ld+json where the page has it. If you have
**selected** more than 200 characters before pressing the button, the selection
goes too and is preferred over any CSS selector — useful on a site nobody has a
learned selector for yet.

Nothing is sent until you press the button: the extension asks for `activeTab`
rather than permission to read every site, so it can only see a page you have
explicitly handed it.

## Publishing

Before packing for the store, drop the two localhost entries from
`host_permissions` and the `content_scripts` block from `manifest.json` — they
exist for development and will otherwise widen what reviewers see the extension
asking for. Then set `NUXT_PUBLIC_EXTENSION_ID` on the frontend to the published
id so `/rozszerzenie` knows who to hand tokens to.
