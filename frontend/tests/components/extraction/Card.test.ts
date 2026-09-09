import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Card from "../../../app/components/extraction/Card.vue";
import type { ExtractionFact } from "../../../shared/model";

function fact(fields: Partial<ExtractionFact> = {}): ExtractionFact {
  return {
    id: "fact-1",
    url: "example.com/a",
    articleUrl: "example.com/a",
    articleDomain: "example.com",
    justification: "radny PiS Piotr Gajda",
    fact_type: "party_membership",
    person: "Piotr Gajda",
    party: "Prawo i Sprawiedliwość",
    tag: "v26",
    ...fields,
  } as ExtractionFact;
}

describe("ExtractionCard", () => {
  it("says nothing about the graph when nobody was matched", async () => {
    const card = await mountSuspended(Card, { props: { fact: fact() } });

    expect(card.text()).toContain("Piotr Gajda");
    expect(card.text()).toContain("osoba");
    expect(card.text()).not.toContain("osoba w bazie");
    // No match, nothing to dispute.
    expect(card.text()).not.toContain("To nie ta osoba");
    expect(card.find("a[href^='/osoba/']").exists()).toBe(false);
  });

  it("links a matched fact to the person it was attached to", async () => {
    const card = await mountSuspended(Card, {
      props: {
        fact: fact({
          personNodeId: "KIZV3jJgniMdX7AoRxN9",
          personNodeName: "Piotr Gajda",
        }),
      },
    });

    expect(card.text()).toContain("osoba w bazie");
    expect(
      card.find("a[href='/osoba/piotr-gajda-KIZV3jJgniMdX7AoRxN9']").exists(),
    ).toBe(true);
  });

  it("shows the name the article used, and links by the node's own", async () => {
    // The two differ: the article dropped the diacritics, and the url slug has
    // to be built from what the node is actually called.
    const card = await mountSuspended(Card, {
      props: {
        fact: fact({
          person: "Krzysztof Kozlowski",
          personNodeId: "08h8mNRYfRX9AsesDM85",
          personNodeName: "Krzysztof Kozłowski",
        }),
      },
    });

    expect(card.text()).toContain("Krzysztof Kozlowski");
    expect(
      card
        .find("a[href='/osoba/krzysztof-kozlowski-08h8mNRYfRX9AsesDM85']")
        .exists(),
    ).toBe(true);
  });

  it("offers the flag on a matched fact", async () => {
    const card = await mountSuspended(Card, {
      props: {
        fact: fact({
          personNodeId: "KIZV3jJgniMdX7AoRxN9",
          personNodeName: "Piotr Gajda",
        }),
      },
    });

    expect(card.text()).toContain("To nie ta osoba");
  });

  it("says so when somebody has already flagged the match", async () => {
    const card = await mountSuspended(Card, {
      props: {
        fact: fact({
          personNodeId: "KIZV3jJgniMdX7AoRxN9",
          personNodeName: "Piotr Gajda",
          stats: { votes: { wrongPerson: 1 } } as ExtractionFact["stats"],
        }),
      },
    });

    expect(card.text()).toContain("Zgłoszono złe dopasowanie");
  });

  it("cannot flag a fact it has no id for", async () => {
    // Grouped listings render facts straight from the API, and one without an
    // id has no vote document to write to.
    const card = await mountSuspended(Card, {
      props: {
        fact: fact({
          id: undefined,
          personNodeId: "KIZV3jJgniMdX7AoRxN9",
          personNodeName: "Piotr Gajda",
        }),
      },
    });

    expect(card.text()).toContain("osoba w bazie");
    expect(card.text()).not.toContain("To nie ta osoba");
  });

  it("shows what readers made of a fact, and stays quiet when nobody has", async () => {
    const judged = await mountSuspended(Card, {
      props: {
        fact: fact({
          stats: {
            votes: { correct: 3, humanVoted: true, humanCount: 3 },
          } as ExtractionFact["stats"],
        }),
      },
    });
    expect(
      judged.find("[data-testid='extraction-vote-count']").text(),
    ).toContain("Potwierdzony");

    const untouched = await mountSuspended(Card, { props: { fact: fact() } });
    expect(
      untouched.find("[data-testid='extraction-vote-count']").exists(),
    ).toBe(false);
  });

  it("greys itself when asked to stand behind a confirmed one", async () => {
    const card = await mountSuspended(Card, {
      props: { fact: fact(), muted: true },
    });

    expect(card.find(".extraction-card").classes()).toContain(
      "extraction-card--muted",
    );
  });

  describe("the link to the quoted passage", () => {
    function href(card: Awaited<ReturnType<typeof mountSuspended>>) {
      return card.find("a.source-block").attributes("href") ?? "";
    }

    it("asks for a short quote whole, in one directive", async () => {
      const card = await mountSuspended(Card, {
        props: {
          fact: fact({ justification_in_text: "prezes banku Mariola Nowak" }),
        },
      });

      expect(href(card)).toContain("#:~:text=");
      expect(href(card)).not.toContain("&text=");
    });

    it("closes up the space the extractor leaves before punctuation", async () => {
      // `justification_in_text` comes out of the pipeline's tokeniser, and a
      // text fragment matches the article's rendered text - where the comma
      // sits against the word.
      const card = await mountSuspended(Card, {
        props: {
          fact: fact({
            justification_in_text:
              "Kurek został wiceprezesem Przedsiębiorstwa Gospodarki Komunalnej .",
          }),
        },
      });

      expect(decodeURIComponent(href(card))).toContain("Komunalnej.");
      expect(decodeURIComponent(href(card))).not.toContain("Komunalnej .");
    });

    it("falls back to whole sentences when the range can't match", async () => {
      // The rmf24.pl case a reader reported: the scraper glued a subheading
      // onto the paragraph under it, so the five opening words straddle a
      // block boundary and the textStart,textEnd range fails as a whole. Each
      // sentence sits inside one block and still lands.
      const card = await mountSuspended(Card, {
        props: {
          fact: fact({
            justification_in_text:
              "Rafał Trzaskowski (Koalicja Obywatelska) Warszawiak i prezydent " +
              "stolicy od 2018 roku. Trzaskowski wychował się w rodzinie " +
              "artystycznej. Przyrodnim bratem Trzaskowskiego jest Piotr Ferster.",
          }),
        },
      });

      const decoded = decodeURIComponent(href(card));
      // The whole-passage range stays first: the browser scrolls to the first
      // directive that matched, so nothing moves on the articles where it works.
      expect(decoded).toContain(
        "text=Rafał Trzaskowski (Koalicja Obywatelska) Warszawiak,",
      );
      expect(href(card)).toContain("&text=");
      expect(decoded).toContain("Przyrodnim bratem Trzaskowskiego jest Piotr");
    });

    it("hands the quote over for the article's own find bar", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      const card = await mountSuspended(Card, {
        props: {
          fact: fact({
            justification_in_text: "prezes banku Mariola Nowak , radna miasta",
          }),
        },
      });

      await card.find("[data-testid='extraction-copy-quote']").trigger("click");

      // Normalised the same way the fragment is: what the article renders is
      // what a reader will be searching for.
      expect(writeText).toHaveBeenCalledWith(
        "prezes banku Mariola Nowak, radna miasta",
      );
    });

    it("offers nothing to copy when there is no article to look in", async () => {
      const card = await mountSuspended(Card, {
        props: { fact: fact({ articleUrl: "" }) },
      });

      expect(card.find("[data-testid='extraction-copy-quote']").exists()).toBe(
        false,
      );
    });
  });
});
