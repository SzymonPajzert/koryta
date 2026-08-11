import { describe, it, expect } from "vitest";
// @ts-expect-error - the extension is plain JS with no types of its own.
import * as extension from "../../../extension/facts.js";
import {
  factConnector,
  factSubject,
  factTarget,
  factTargetKind,
  factTypeLabel,
} from "~/utils/extraction";
import type { ExtractionFact } from "~~/shared/model";

function fact(overrides: Partial<ExtractionFact>): ExtractionFact {
  return {
    url: "example.pl/a",
    articleUrl: "example.pl/a",
    tag: "v1",
    justification: "Bo tak napisano.",
    fact_type: "employment",
    ...overrides,
  } as ExtractionFact;
}

const SAMPLES = [
  fact({
    fact_type: "employment",
    person: "Jan Kowalski",
    role: "prezes",
    organization: "Orlen",
  }),
  // A role the model did not name: the site falls back to a generic word, and
  // the panel has to fall back to the same one.
  fact({
    fact_type: "employment",
    person: "Jan Kowalski",
    organization: "Orlen",
  }),
  fact({
    fact_type: "party_membership",
    person: "Jan Kowalski",
    party: "PiS",
  }),
  fact({
    fact_type: "personal_relation",
    subject: "Jan Kowalski",
    relation: "brat",
    object: "Anna Kowalska",
  }),
  fact({ fact_type: "personal_relation", subject: "Jan Kowalski" }),
];

/** The extension carries its own copy of the site's fact vocabulary, because
 * Nuxt compiles `~/utils/extraction` and an unpacked extension loads its files
 * as they are. A copy is only safe while something fails when the two drift —
 * which is this. */
describe("the extension says what the website says", () => {
  it.each(SAMPLES)("about a $fact_type fact", (sample) => {
    expect(extension.factSubject(sample)).toBe(factSubject(sample));
    expect(extension.factTarget(sample)).toBe(factTarget(sample));
    expect(extension.factConnector(sample)).toBe(factConnector(sample));
    expect(extension.factTargetKind(sample)).toBe(factTargetKind(sample));
    expect(extension.factTypeLabel(sample)).toBe(factTypeLabel(sample));
  });

  it("names a type the site's union does not have yet", () => {
    // The site narrows `fact_type` at compile time and can index its table
    // directly. What reaches the extension came over the wire from a server
    // that may have been deployed since, so an unknown type has to render as
    // something rather than as "undefined".
    const unknown = fact({ fact_type: "court_ruling" as never });
    expect(extension.factTypeLabel(unknown)).toBe("court_ruling");
  });
});

describe("factWord", () => {
  it("counts in Polish", () => {
    expect(extension.factWord(1)).toBe("fakt");
    expect(extension.factWord(2)).toBe("fakty");
    expect(extension.factWord(4)).toBe("fakty");
    expect(extension.factWord(5)).toBe("faktów");
    // 12-14 are the exception to the 2-4 rule, and 22-24 are not.
    expect(extension.factWord(12)).toBe("faktów");
    expect(extension.factWord(14)).toBe("faktów");
    expect(extension.factWord(22)).toBe("fakty");
    expect(extension.factWord(112)).toBe("faktów");
    expect(extension.factWord(0)).toBe("faktów");
  });
});

describe("factQuote", () => {
  it("prefers the span that is really on the page", () => {
    // `justification` is the model's own wording and need not appear in the
    // article; `justification_in_text` was resolved back to a verbatim slice.
    // Only the latter can be found and scrolled to.
    const sample = fact({
      justification: "Kowalski kieruje spółką.",
      justification_in_text: "prezesem Orlenu jest Jan Kowalski",
    });
    expect(extension.factQuote(sample)).toBe(
      "prezesem Orlenu jest Jan Kowalski",
    );
    expect(extension.factQuote(fact({ justification_in_text: null }))).toBe(
      "Bo tak napisano.",
    );
  });
});

describe("factCard", () => {
  it("puts every string in as text, never as markup", () => {
    // Each of these came from a page somebody else wrote, by way of a model.
    const card = extension.factCard(
      fact({
        person: "<img src=x onerror=alert(1)>",
        role: "prezes",
        organization: "Orlen",
        justification: "<script>alert(2)</script>",
      }),
    );
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector("script")).toBeNull();
    expect(card.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("makes the quote a button only when there is somewhere to go", () => {
    const inert = extension.factCard(fact({ person: "Jan Kowalski" }));
    expect(inert.querySelector("button")).toBeNull();

    const quotes: string[] = [];
    const clickable = extension.factCard(fact({ person: "Jan Kowalski" }), {
      onQuote: (quote: string) => quotes.push(quote),
    });
    const button = clickable.querySelector("button");
    expect(button).not.toBeNull();
    button!.dispatchEvent(new MouseEvent("click"));
    expect(quotes).toEqual(["Bo tak napisano."]);
  });

  it("leaves out a target the fact does not assert", () => {
    // A personal_relation with no object has nothing to point the arrow at;
    // the site drops the right-hand column for the same reason.
    const card = extension.factCard(
      fact({ fact_type: "personal_relation", subject: "Jan Kowalski" }),
    );
    expect(card.querySelector(".edge__entity--target")).toBeNull();
  });
});
