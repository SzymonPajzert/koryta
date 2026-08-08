/** What runs inside the page being captured.
 *
 * Injected wholesale by `chrome.scripting.executeScript`, so it has to be one
 * self-contained function with no imports and a JSON-serialisable return value
 * — that is a constraint of the injection API, not a style choice.
 *
 * It reads the DOM as rendered, which is the entire point: the article the
 * reader is looking at has already been through the paywall, the consent
 * dialog and whatever javascript assembles the body, none of which the crawler
 * gets to see.
 */
export function collectPage() {
  const pick = (selector, attribute) => {
    const element = document.querySelector(selector);
    if (!element) return undefined;
    const value = attribute ? element.getAttribute(attribute) : element.textContent;
    return value ? value.trim() : undefined;
  };

  const ldJson = [];
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    try {
      ldJson.push(JSON.parse(script.textContent || ""));
    } catch {
      // A site with malformed ld+json is common enough not to be worth
      // reporting; the html still carries it for the parser to try again.
    }
  }

  const fromLdJson = (key) => {
    const visit = (node) => {
      if (Array.isArray(node)) {
        for (const item of node) {
          const found = visit(item);
          if (found) return found;
        }
        return undefined;
      }
      if (node && typeof node === "object") {
        if (typeof node[key] === "string" && node[key].trim()) {
          return node[key].trim();
        }
        for (const value of Object.values(node)) {
          const found = visit(value);
          if (found) return found;
        }
      }
      return undefined;
    };
    return visit(ldJson);
  };

  // The canonical url, so two readers capturing the same article through
  // different tracking links file it in the same place. The fragment always
  // goes; the query stays, because for some Polish sites it is the article id.
  const canonical =
    pick("link[rel=canonical]", "href") ||
    pick('meta[property="og:url"]', "content") ||
    location.href;
  let url = canonical;
  try {
    const parsed = new URL(canonical, location.href);
    parsed.hash = "";
    url = parsed.toString();
  } catch {
    url = location.href.split("#")[0];
  }

  const selection = (window.getSelection && window.getSelection().toString()) || "";

  return {
    url,
    title:
      fromLdJson("headline") ||
      pick('meta[property="og:title"]', "content") ||
      document.title ||
      null,
    publishedDate:
      fromLdJson("datePublished") ||
      pick('meta[property="article:published_time"]', "content") ||
      fromLdJson("dateModified") ||
      undefined,
    html: document.documentElement.outerHTML,
    // A reader who highlighted the article body has told us where it is, which
    // beats guessing with a selector on a site nobody has a selector for.
    selection: selection.length > 200 ? selection : "",
    ldJson: ldJson.length ? ldJson[0] : undefined,
  };
}
