/** Finding a quoted passage in the article the reader has open.
 *
 * The website links a fact's quote to `#:~:text=`, which is the right answer
 * there — the article is somewhere else, and the fragment opens it at the
 * passage. Here the article is already on screen, immediately left of the
 * panel, so opening a second copy of it would be a strange thing to do. This
 * scrolls the tab that is already showing it.
 *
 * Injected wholesale by `chrome.scripting.executeScript`, so like `capture.js`
 * it has to be one self-contained function with no imports and a
 * JSON-serialisable return value.
 */
export function scrollToQuote(quote) {
  const HIGHLIGHT = "koryta-fact";

  /** The form both haystack and needle are compared in.
   *
   * Case, typographic quotes and dashes, and runs of whitespace all differ
   * between what the extractor stored and what the page renders — the quote has
   * been through a model and through the pipeline's own cleaning. Comparing the
   * canonical form of each is what makes a match likely; the offsets recorded
   * alongside are what makes it possible to point back at the real DOM.
   */
  const canonical = (character) => {
    if (/\s/.test(character)) return " ";
    if (/[„""»«”“]/.test(character)) return '"';
    if (/[–—]/.test(character)) return "-";
    return character.toLowerCase();
  };

  const needleOf = (text) => {
    let out = "";
    for (const character of String(text)) {
      const mapped = canonical(character);
      if (mapped === " " && out.endsWith(" ")) continue;
      out += mapped;
    }
    return out.trim();
  };

  // The article's text, canonicalised, with every character remembering which
  // text node and offset it came from.
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        // Script and style text is in the DOM and is not on the page; matching
        // inside it would scroll to something invisible.
        if (parent.closest("script, style, noscript, template")) {
          return NodeFilter.FILTER_REJECT;
        }
        return node.nodeValue?.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    },
  );

  let haystack = "";
  const nodes = [];
  const offsets = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue || "";
    for (let index = 0; index < value.length; index += 1) {
      const mapped = canonical(value[index]);
      if (mapped === " " && haystack.endsWith(" ")) continue;
      haystack += mapped;
      nodes.push(node);
      offsets.push(index);
    }
  }

  /** A range over `haystack[at .. at+length)`, back in the real DOM. */
  const rangeAt = (at, length) => {
    const range = document.createRange();
    range.setStart(nodes[at], offsets[at]);
    const last = at + length - 1;
    range.setEnd(nodes[last], offsets[last] + 1);
    return range;
  };

  // Whole quote first. A `justification` the model wrote in its own words is
  // often not on the page at all, so failing that, the opening words are tried
  // — the same climbdown the site's text fragment makes, and for the same
  // reason: a mismatch in the middle should not lose the whole passage.
  const full = needleOf(quote);
  if (!full) return { found: false };

  const words = full.split(" ");
  const candidates = [full];
  for (const count of [10, 6]) {
    if (words.length > count) candidates.push(words.slice(0, count).join(" "));
  }

  let range;
  for (const candidate of candidates) {
    const at = haystack.indexOf(candidate);
    if (at !== -1) {
      range = rangeAt(at, candidate.length);
      break;
    }
  }
  if (!range) return { found: false };

  const target = range.startContainer.parentElement;
  if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });

  // The Custom Highlight API paints the passage without touching the article's
  // markup — no wrapper elements in someone else's DOM, and nothing to undo.
  // It also leaves the reader's own selection alone, which matters because
  // selecting a passage is how the panel is told to extract from one.
  if (window.CSS?.highlights) {
    if (!document.getElementById("koryta-highlight-style")) {
      const style = document.createElement("style");
      style.id = "koryta-highlight-style";
      style.textContent = `::highlight(${HIGHLIGHT}) { background: #ffe066; color: #1c1b1f; }`;
      document.head.append(style);
    }
    CSS.highlights.set(HIGHLIGHT, new Highlight(range));
  }

  return { found: true };
}

/** Takes the highlight back off, leaving the article as it was found. */
export function clearQuoteHighlight() {
  window.CSS?.highlights?.delete("koryta-fact");
  document.getElementById("koryta-highlight-style")?.remove();
}
