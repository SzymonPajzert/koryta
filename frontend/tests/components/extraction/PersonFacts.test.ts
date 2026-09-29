import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { clearNuxtData } from "#app";
import { getQuery } from "h3";
import PersonFacts from "../../../app/components/extraction/PersonFacts.vue";
import type { ExtractionFact, Note } from "../../../shared/model";

const currentUser = ref<{ uid: string } | null>({ uid: "reader" });
vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  useAuthState: () => ({ user: currentUser }),
}));

/** The listener this section must never open. Spied rather than asserted on by
 * component name: an auto-imported component answers to more than one, and a
 * `findComponent` that never matches passes whatever the section renders. */
const { useVotes } = vi.hoisted(() => ({ useVotes: vi.fn() }));
vi.mock("~/composables/votes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/votes")>()),
  useVotes,
}));

/** The reader's note, which „Dodaj do notatki” writes into. Stubbed because the
 * real one reaches for a Firebase app this environment has none of; what the
 * entry it writes looks like is `AddToNoteButton.test.ts`. */
const userNote = ref<Note | null>(null);
const { saveNote } = vi.hoisted(() => ({
  saveNote: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/composables/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/notes")>()),
  useNotes: () => ({ userNote, saveNote, otherNotes: ref([]) }),
}));

/** What the endpoint answers with, set by each test before it mounts. */
let response: { facts: ExtractionFact[]; total: number } | null = {
  facts: [],
  total: 0,
};

/** The query the component actually sent — the whole point of the section is
 * that it asks by node id and not by name, and that a logged out reader's
 * request never asks for the facts themselves. */
let lastQuery: Record<string, unknown> = {};

registerEndpoint("/api/extractions", (event) => {
  lastQuery = getQuery(event);
  if (response === null) throw new Error("index missing");
  // The real handler returns no facts for a count-only request; mirroring that
  // here is what makes the logged out assertions mean anything.
  if (lastQuery.countOnly) return { facts: [], total: response.total };
  return response;
});

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
    personNodeId: "abc123",
    personNodeName: "Piotr Gajda",
    tag: "v26",
    ...fields,
  } as ExtractionFact;
}

async function mount() {
  const section = await mountSuspended(PersonFacts, {
    props: { nodeId: "abc123" },
  });
  await flushPromises();
  return section;
}

describe("ExtractionPersonFacts", () => {
  beforeEach(() => {
    clearNuxtData();
    response = { facts: [], total: 0 };
    lastQuery = {};
    currentUser.value = { uid: "reader" };
  });

  it("asks for one person's facts by node id, not by name", async () => {
    response = { facts: [fact()], total: 1 };
    await mount();

    expect(lastQuery.personNodeId).toBe("abc123");
    // A name would collect the namesakes this whole feature exists to keep
    // apart, so it must not be in the query at all.
    expect(lastQuery.person).toBeUndefined();
  });

  it("renders a card per matched fact under a heading", async () => {
    response = {
      facts: [fact(), fact({ id: "fact-2" })],
      total: 2,
    };
    const section = await mount();

    expect(section.find("[data-testid='person-extractions']").exists()).toBe(
      true,
    );
    expect(section.text()).toContain("Fakty z artykułów");
    expect(section.findAll(".extraction-card")).toHaveLength(2);
  });

  it("lays the cards out two to a row from md up", async () => {
    response = { facts: [fact(), fact({ id: "fact-2" })], total: 2 };
    const section = await mount();

    // Full width on a phone, half from md — what `cols="12" md="6"` compiles to.
    const cols = section.findAll(".v-col-12");
    expect(cols).toHaveLength(2);
    expect(cols[0]!.classes()).toContain("v-col-md-6");
  });

  it("offers a verdict on every card, without opening a listener", async () => {
    // A reader looking up one person should be able to judge what is said
    // about them where it is shown. `ExtractionQuickVerdict` is a write and
    // nothing else; `useVotes` - what the review queue's copy of this row is
    // built on - subscribes to the fact's vote document, and this section
    // mounts every card at once instead of behind an expander.
    response = { facts: [fact(), fact({ id: "fact-2" })], total: 2 };
    const section = await mount();

    expect(section.findAll("[data-testid='verdict-buttons']")).toHaveLength(2);
    expect(useVotes).not.toHaveBeenCalled();
  });

  it("offers to move each fact into the reader's own note", async () => {
    // What a verdict on its own leads to: „poprawny” is a number nobody reads
    // back, while a note entry stands in the section above under the reader's
    // name and is what the article promotion runs over.
    response = { facts: [fact(), fact({ id: "fact-2" })], total: 2 };
    const section = await mount();

    const buttons = section.findAll("[data-testid='extraction-add-to-note']");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.text()).toContain("Dodaj do notatki");
  });

  it("offers to make a relation of each fact that can become one", async () => {
    // „Brakuje chyba jeszcze promocji do krawędzi” - the queue and the
    // article's page could turn a fact into a relation, the person's own page
    // could only file it in a note. A party membership has no relation to
    // become (a party is not a node), so its card has no such button.
    response = {
      facts: [
        fact({
          id: "job",
          fact_type: "employment",
          organization: "Spółka Wodna",
          role: "prezes zarządu",
        }),
        fact({ id: "party" }),
      ],
      total: 2,
    };
    const section = await mount();

    const buttons = section.findAll("[data-testid='extraction-promote']");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.text()).toContain("Utwórz powiązanie");
  });

  it("leads from each fact to its article's page on the site", async () => {
    // The quote goes out to the newspaper; the article's page here - its
    // topics, who else it names, the other facts in it - was reachable from
    // nowhere on a person's page.
    response = {
      facts: [fact({ articleNodeId: "art1" }), fact({ id: "fact-2" })],
      total: 2,
    };
    const section = await mount();

    const links = section.findAll("[data-testid='extraction-article-page']");
    expect(links).toHaveLength(1);
    expect(links[0]!.attributes("href")).toBe("/entity/article/art1");
  });

  it("says in the open that the facts may be wrong, and the rest behind the (i)", async () => {
    // „Ten tekst podobnie jak w notatce powinien być domyślnie schowany bo
    // robi bloat” - four sentences stood between the heading and the cards.
    // The warning is the half a reader needs before trusting a card, so it
    // stays; how to judge one is a click away.
    response = { facts: [fact()], total: 1 };
    const section = await mount();

    expect(section.get("[data-testid='person-extractions-lead']").text()).toBe(
      "Automatycznie wyszukane w prasie - mogą być błędne.",
    );
    expect(section.text()).not.toContain("po imieniu i nazwisku");

    await section.get("[data-testid='section-info']").trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("po imieniu i nazwisku");
    expect(document.body.textContent).toContain("„To nie ta osoba”");
  });

  it("renders nothing at all when the person has no matched facts", async () => {
    response = { facts: [], total: 0 };
    const section = await mount();

    // Not an empty heading: a section announcing itself over empty space reads
    // as a page that failed to load, and most people have no matched facts.
    expect(section.find("[data-testid='person-extractions']").exists()).toBe(
      false,
    );
    expect(section.text()).not.toContain("Fakty z artykułów");
  });

  it("stays silent when the query fails", async () => {
    // The composite index this query needs is deployed by hand, so a failing
    // endpoint is a state a public person page can really be in. It must cost
    // the page a section, not the render.
    response = null;
    const section = await mount();

    expect(section.find("[data-testid='person-extractions']").exists()).toBe(
      false,
    );
  });

  it("says so when it is showing only part of what was found", async () => {
    response = { facts: [fact()], total: 40 };
    const section = await mount();

    expect(
      section.find("[data-testid='person-extractions-hidden']").text(),
    ).toContain("40");
  });

  describe("what readers have made of the facts", () => {
    it("puts what readers confirmed above what nobody has judged", async () => {
      response = {
        facts: [
          fact({ id: "open", party: "Partia Niesprawdzona" }),
          fact({
            id: "confirmed",
            party: "Partia Potwierdzona",
            stats: {
              votes: { correct: 2, humanVoted: true, humanCount: 2 },
            } as ExtractionFact["stats"],
          }),
        ],
        total: 2,
      };
      const section = await mount();

      const cards = section.findAll(".extraction-card");
      expect(cards).toHaveLength(2);
      // Confirmed first, whatever order the endpoint sent them in.
      expect(cards[0]!.text()).toContain("Partia Potwierdzona");
      expect(cards[1]!.text()).toContain("Partia Niesprawdzona");
      expect(cards[1]!.classes()).toContain("extraction-card--muted");
      expect(
        section.find("[data-testid='person-extractions-confirmed']").exists(),
      ).toBe(true);
      expect(
        section.find("[data-testid='person-extractions-open']").exists(),
      ).toBe(true);
    });

    it("draws no line when everything is on the same side of it", async () => {
      // Almost every person's facts are entirely unjudged today, and a heading
      // saying so over all of them is the lead paragraph again in small type.
      response = { facts: [fact(), fact({ id: "fact-2" })], total: 2 };
      const section = await mount();

      expect(
        section.find("[data-testid='person-extractions-open']").exists(),
      ).toBe(false);
      expect(section.find(".extraction-card").classes()).not.toContain(
        "extraction-card--muted",
      );
    });

    it("counts the people who voted on a fact", async () => {
      response = {
        facts: [
          fact({
            stats: {
              votes: { correct: 2, humanVoted: true, humanCount: 2 },
            } as ExtractionFact["stats"],
          }),
        ],
        total: 1,
      };
      const section = await mount();

      expect(
        section.find("[data-testid='extraction-vote-count']").text(),
      ).toContain("Potwierdzony");
      expect(
        section.find("[data-testid='extraction-vote-count']").text(),
      ).toContain("2 głosy");
    });

    it("says nothing about votes on a fact nobody has read", async () => {
      response = { facts: [fact()], total: 1 };
      const section = await mount();

      expect(
        section.find("[data-testid='extraction-vote-count']").exists(),
      ).toBe(false);
    });
  });

  describe("filtering by type", () => {
    it("offers no filter when every fact is of one kind", async () => {
      response = {
        facts: [fact(), fact({ id: "fact-2" })],
        total: 2,
      };
      const section = await mount();

      expect(
        section.find("[data-testid='person-extractions-filter']").exists(),
      ).toBe(false);
    });

    it("names each kind the person has, with how many of each", async () => {
      response = {
        facts: [
          fact(),
          fact({ id: "fact-2", fact_type: "personal_relation" }),
          fact({ id: "fact-3", fact_type: "personal_relation" }),
        ],
        total: 3,
      };
      const section = await mount();

      const filter = section.find("[data-testid='person-extractions-filter']");
      expect(filter.exists()).toBe(true);
      expect(filter.text()).toContain("Relacja osobista (2)");
      expect(filter.text()).toContain("Członkostwo partyjne (1)");
      expect(filter.text()).toContain("Wszystkie (3)");
    });

    it("keeps only the chosen kind, and gives the rest back", async () => {
      response = {
        facts: [
          fact(),
          fact({ id: "fact-2", fact_type: "personal_relation" }),
          fact({ id: "fact-3", fact_type: "personal_relation" }),
        ],
        total: 3,
      };
      const section = await mount();

      await section
        .find("[data-testid='person-extractions-filter-personal_relation']")
        .trigger("click");
      await flushPromises();
      expect(section.findAll(".extraction-card")).toHaveLength(2);

      await section
        .findAll("[data-testid='person-extractions-filter'] .v-chip")[0]!
        .trigger("click");
      await flushPromises();
      expect(section.findAll(".extraction-card")).toHaveLength(3);
    });
  });

  describe("paging", () => {
    // „Pokazujemy 24 najnowszych z 66 -> dlaczego tylko 24? Nie ma sposobu na
    // przejrzenie wszystkiego”, and from a phone: „max 6 było i dalej już
    // strony, inaczej ciężko dojść do sekcji dyskusja”.

    /** `count` facts, newest first, as the endpoint sends them. */
    function many(count: number, fields: Partial<ExtractionFact> = {}) {
      return Array.from({ length: count }, (_, index) =>
        fact({ id: `fact-${index}`, party: `Partia ${index}`, ...fields }),
      );
    }

    function setWidth(width: number) {
      window.innerWidth = width;
      window.dispatchEvent(new Event("resize"));
    }

    const pager = (section: Awaited<ReturnType<typeof mount>>) =>
      section.find("[data-testid='person-extractions-pages']");

    async function goToPage(
      section: Awaited<ReturnType<typeof mount>>,
      page: number,
    ) {
      await pager(section)
        .find(`[aria-label='Przejdź do strony ${page}']`)
        .trigger("click");
      await flushPromises();
    }

    afterEach(() => setWidth(1024));

    it("asks for every fact at once, so the rest is a page away", async () => {
      // The page is cut here rather than by the endpoint - see the component
      // for why. What the request must not do any more is stop at 24.
      response = { facts: many(3), total: 3 };
      await mount();

      expect(Number(lastQuery.limit)).toBeGreaterThanOrEqual(100);
      expect(lastQuery.page).toBeUndefined();
    });

    it("shows 24 on a desktop and pages to the rest", async () => {
      response = { facts: many(30), total: 30 };
      const section = await mount();

      expect(section.findAll(".extraction-card")).toHaveLength(24);
      expect(pager(section).exists()).toBe(true);
      // The whole set came back, so there is nothing withheld to own up to.
      expect(
        section.find("[data-testid='person-extractions-hidden']").exists(),
      ).toBe(false);

      await goToPage(section, 2);
      const cards = section.findAll(".extraction-card");
      expect(cards).toHaveLength(6);
      expect(cards[0]!.text()).toContain("Partia 24");
    });

    it("shows six at a time on a phone", async () => {
      setWidth(393);
      response = { facts: many(14), total: 14 };
      const section = await mount();

      expect(section.findAll(".extraction-card")).toHaveLength(6);
      await goToPage(section, 3);
      expect(section.findAll(".extraction-card")).toHaveLength(2);
    });

    it("keeps the card being read on screen when the window crosses md", async () => {
      // Page five of six-a-page is facts 24-29, which is page two of
      // 24-a-page - not page five clamped to the two pages there now are.
      setWidth(393);
      response = { facts: many(30), total: 30 };
      const section = await mount();

      await goToPage(section, 5);
      expect(section.findAll(".extraction-card")[0]!.text()).toContain(
        "Partia 24",
      );

      setWidth(1024);
      await flushPromises();
      let cards = section.findAll(".extraction-card");
      expect(cards).toHaveLength(6);
      expect(cards[0]!.text()).toContain("Partia 24");

      setWidth(393);
      await flushPromises();
      cards = section.findAll(".extraction-card");
      expect(cards).toHaveLength(6);
      expect(cards[0]!.text()).toContain("Partia 24");
    });

    it("offers no pager when everything fits on one page", async () => {
      response = { facts: many(6), total: 6 };
      const section = await mount();

      expect(pager(section).exists()).toBe(false);
    });

    it("pages over the chosen kind alone, starting from its first page", async () => {
      setWidth(393);
      response = {
        facts: [
          ...many(10),
          ...many(4, { fact_type: "personal_relation" }).map((each, index) => ({
            ...each,
            id: `relation-${index}`,
          })),
        ],
        total: 14,
      };
      const section = await mount();

      await goToPage(section, 2);
      await section
        .find("[data-testid='person-extractions-filter-personal_relation']")
        .trigger("click");
      await flushPromises();

      // Four of them, all on page one: a reader left on page two of the
      // unfiltered list would be looking at an empty grid.
      expect(section.findAll(".extraction-card")).toHaveLength(4);
      expect(pager(section).exists()).toBe(false);
    });

    it("puts the confirmed ones on the first page, wherever they arrived", async () => {
      setWidth(393);
      response = {
        facts: [
          ...many(8),
          fact({
            id: "confirmed",
            party: "Partia Potwierdzona",
            stats: {
              votes: { correct: 2, humanVoted: true, humanCount: 2 },
            } as ExtractionFact["stats"],
          }),
        ],
        total: 9,
      };
      const section = await mount();

      expect(section.findAll(".extraction-card")[0]!.text()).toContain(
        "Partia Potwierdzona",
      );

      // Page two is all unchecked: it says so, and has no empty confirmed
      // heading over nothing.
      await goToPage(section, 2);
      expect(
        section.find("[data-testid='person-extractions-confirmed']").exists(),
      ).toBe(false);
      expect(
        section.find("[data-testid='person-extractions-open']").exists(),
      ).toBe(true);
      expect(section.findAll(".extraction-card")).toHaveLength(3);
    });
  });

  describe("logged out", () => {
    beforeEach(() => {
      currentUser.value = null;
    });

    it("never asks the server for the facts themselves", async () => {
      // The lock is the request, not the blur: `filter` is a paint
      // instruction, so anything fetched would sit readable in the html of a
      // named person's canonical url.
      response = { facts: [fact()], total: 3 };
      await mount();

      expect(lastQuery.countOnly).toBe("true");
      expect(lastQuery.personNodeId).toBe("abc123");
    });

    it("says how many were found and offers a way in", async () => {
      response = { facts: [fact()], total: 3 };
      const section = await mount();

      const count = section.find("[data-testid='person-extractions-count']");
      expect(count.exists()).toBe(true);
      expect(count.text()).toContain("3 fakty");
      expect(
        section.find("[data-testid='person-extractions-locked']").exists(),
      ).toBe(true);
      expect(section.text()).toContain("Zaloguj się lub załóż konto");
    });

    it("has no (i) to open, since it explains cards they are not shown", async () => {
      response = { facts: [], total: 3 };
      const section = await mount();

      expect(section.find("[data-testid='section-info']").exists()).toBe(false);
    });

    it("declines the Polish plural properly", async () => {
      response = { facts: [], total: 5 };
      const section = await mount();

      expect(
        section.find("[data-testid='person-extractions-count']").text(),
      ).toContain("5 faktów");
    });

    it("shows no fact text and no cards at all", async () => {
      response = { facts: [fact()], total: 3 };
      const section = await mount();

      expect(section.findAll(".extraction-card")).toHaveLength(0);
      expect(section.text()).not.toContain("Piotr Gajda");
      expect(section.text()).not.toContain("radny PiS");
      expect(section.html()).not.toContain("Prawo i Sprawiedliwość");
    });

    it("keeps quiet about a person nobody wrote about", async () => {
      response = { facts: [], total: 0 };
      const section = await mount();

      expect(section.find("[data-testid='person-extractions']").exists()).toBe(
        false,
      );
    });

    it("sends the reader back here after logging in", async () => {
      response = { facts: [], total: 2 };
      const section = await mount();

      // The button's target rather than the rendered href: RouterLink resolves
      // to an anchor with no href under the test router, so the attribute says
      // nothing about what the app would do.
      const button = section.findComponent({ name: "VBtn" });
      expect(button.props("to")).toContain("/login?redirect=");
    });
  });
});
