/** Facts, said and drawn the way koryta.pl says and draws them.
 *
 * The site renders every extracted fact as an edge — subject ── connector ──▶
 * target — over the sentence the model believed it on. Anyone who reviews facts
 * at /ekstrakcje reads that shape, so the panel that sits beside the article
 * uses it too rather than inventing a second vocabulary for the same documents.
 *
 * This is deliberately a plain-DOM copy of `frontend/app/utils/extraction.ts`
 * and `components/extraction/Card.vue` rather than a shared module: those are
 * Vue and TypeScript that Nuxt compiles, and an unpacked extension loads its
 * files exactly as they are on disk. The labels are the seam that can drift, so
 * `frontend/tests/extension/facts.test.ts` imports both sides and pins them
 * against each other.
 */

const TYPE_LABELS = {
  employment: "Zatrudnienie",
  party_membership: "Członkostwo partyjne",
  personal_relation: "Relacja osobista",
};

/** Left-hand entity: the person the fact is about. */
export function factSubject(fact) {
  return fact.person || fact.subject || "—";
}

/** Right-hand entity: organization, party, or the related person. */
export function factTarget(fact) {
  if (fact.fact_type === "employment") return fact.organization;
  if (fact.fact_type === "party_membership") return fact.party;
  return fact.object; // personal_relation
}

/** The label on the arrow between the two entities. */
export function factConnector(fact) {
  if (fact.fact_type === "employment") return fact.role || "zatrudnienie";
  if (fact.fact_type === "party_membership") return "członek";
  return fact.relation || "relacja"; // personal_relation
}

/** Kind caption under the right-hand entity ("" when its type is not asserted). */
export function factTargetKind(fact) {
  if (fact.fact_type === "employment") return "organizacja";
  if (fact.fact_type === "party_membership") return "partia";
  return ""; // personal_relation
}

/** The fact type in Polish.
 *
 * Falls back to the raw type, which the site's version does not need to: there
 * the value is a union the compiler has already narrowed, while here it arrived
 * over the wire from a server that may have learned a fourth type since this
 * extension was installed.
 */
export function factTypeLabel(fact) {
  return TYPE_LABELS[fact.fact_type] || fact.fact_type || "";
}

/** "fakt" / "fakty" / "faktów", by Polish rules rather than by English ones. */
export function factWord(count) {
  if (count === 1) return "fakt";
  const rest = count % 10;
  const teens = count % 100;
  return rest >= 2 && rest <= 4 && (teens < 12 || teens > 14)
    ? "fakty"
    : "faktów";
}

/** The passage a fact rests on, preferring the verbatim slice of the article.
 *
 * `justification_in_text` is resolved by the facts pipeline back to a span the
 * article really contains; `justification` is the model's own wording and may
 * not appear anywhere. Only the former can be found on the page, which is what
 * the panel needs in order to scroll to it.
 */
export function factQuote(fact) {
  return fact.justification_in_text || fact.justification || "";
}

/** One fact as a card.
 *
 * Built node by node with textContent rather than innerHTML: every string here
 * came from a page someone else wrote, by way of a model, and neither the popup
 * nor the panel has any business parsing it as markup.
 *
 * `onQuote` makes the quote block a button that hands back the passage — the
 * panel uses it to scroll the article behind it to that sentence. Without it
 * the quote is inert text, which is what the popup wants.
 */
export function factCard(fact, { onQuote } = {}) {
  const card = document.createElement("article");
  card.className = "fact-card";
  if (fact.reviewed) card.classList.add("fact-card--reviewed");

  const edge = document.createElement("div");
  edge.className = "edge";
  edge.append(
    entity(factSubject(fact), "osoba", "edge__entity--source"),
    connector(fact),
  );

  const target = factTarget(fact);
  if (target) {
    edge.append(entity(target, factTargetKind(fact), "edge__entity--target"));
  }
  card.append(edge);

  const quote = factQuote(fact);
  if (quote) card.append(quoteBlock(quote, onQuote));

  return card;
}

function entity(name, kind, modifier) {
  const wrapper = document.createElement("div");
  wrapper.className = `edge__entity ${modifier}`;

  const label = document.createElement("div");
  label.className = "edge__name";
  label.textContent = name;
  wrapper.append(label);

  if (kind) {
    const caption = document.createElement("div");
    caption.className = "edge__kind";
    caption.textContent = kind;
    wrapper.append(caption);
  }
  return wrapper;
}

function connector(fact) {
  const wrapper = document.createElement("div");
  wrapper.className = "edge__connector";

  const chip = document.createElement("span");
  chip.className = "edge__chip";
  chip.dataset.type = fact.fact_type || "";
  chip.textContent = `${factConnector(fact)} →`;
  wrapper.append(chip);

  const type = document.createElement("div");
  type.className = "edge__type";
  type.textContent = factTypeLabel(fact);
  wrapper.append(type);

  return wrapper;
}

function quoteBlock(quote, onQuote) {
  // A button, not a div with a click handler: this is the one interactive part
  // of a card, and it has to be reachable by keyboard like any other control.
  const block = document.createElement(onQuote ? "button" : "div");
  block.className = "quote-block";
  if (onQuote) {
    block.type = "button";
    block.addEventListener("click", () => onQuote(quote));

    const caption = document.createElement("span");
    caption.className = "quote-caption";
    caption.textContent = "Pokaż w artykule";
    block.append(caption);
  }

  const text = document.createElement("blockquote");
  text.className = "quote";
  text.textContent = quote;
  block.append(text);

  return block;
}
