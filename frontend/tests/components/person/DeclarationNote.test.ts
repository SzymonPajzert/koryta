import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import PersonDeclarationNote from "../../../app/components/person/DeclarationNote.vue";
import MentionArticleList from "../../../app/components/mention/ArticleList.vue";
import type { PersonDeclarations } from "../../../shared/declarations";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  // The articles, for the section the note shares its request with.
  authFetch: vi.fn(() => ({ data: ref({ mentions: [] }) })),
  useAuthState: () => ({ user: ref(null) }),
}));

const STRZELIN = "Strzelin (gmina miejsko-wiejska)";

/** Published by the automation at 09:15 in Warsaw, two declarations. */
const auto: PersonDeclarations = {
  autoPublished: { at: "2026-10-29T08:15:00.000Z" },
  declarations: [
    {
      url: "https://bip.example.pl/oswiadczenie-2023.pdf",
      year: 2023,
      unit: STRZELIN,
      office: "Rada gminy",
    },
    {
      url: "https://bip.example.pl/oswiadczenie-2024.pdf",
      year: 2024,
      unit: STRZELIN,
      office: "Rada gminy",
    },
  ],
};

/** A page somebody published by hand, whose date a declaration confirmed. */
const byHand: PersonDeclarations = {
  autoPublished: null,
  declarations: [auto.declarations[1]!],
};

/** The endpoint, by node: a declarations answer, or its 404. */
function answer(byNode: Record<string, PersonDeclarations>) {
  mockAuthRequest.mockImplementation(async (url: string) => {
    const node = /^\/api\/nodes\/([^/]+)\/declarations$/.exec(url)?.[1];
    const found = node ? byNode[node] : undefined;
    if (found) return found;
    throw Object.assign(new Error("Page not found"), { statusCode: 404 });
  });
}

const declarationCalls = (node: string) =>
  mockAuthRequest.mock.calls.filter(
    ([url]) => url === `/api/nodes/${node}/declarations`,
  );

/** The no-break space the note binds its short words and dates with. */
const NBSP = String.fromCharCode(0xa0);

/** The line as a reader reads it: those no-break spaces are spaces. */
const line = (text: string) => text.replaceAll(NBSP, " ").trim();

// Each test asks for its own node: the request is keyed by it, and a key
// another test already filled would be answered from that test's data.
describe("PersonDeclarationNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows nothing at all when the endpoint answers 404", async () => {
    answer({});
    const note = await mountSuspended(PersonDeclarationNote, {
      props: { nodeId: "n404" },
    });
    await flushPromises();

    expect(declarationCalls("n404")).toEqual([
      ["/api/nodes/n404/declarations", { method: "GET" }],
    ]);
    expect(
      note.find('[data-testid="person-declarations-pointer"]').exists(),
    ).toBe(false);
    expect(note.text()).toBe("");
  });

  it("says when the site published the page itself", async () => {
    answer({ nauto: auto });
    const note = await mountSuspended(PersonDeclarationNote, {
      props: { nodeId: "nauto" },
    });
    await flushPromises();

    const pointer = note.get('[data-testid="person-declarations-pointer"]');
    expect(line(pointer.get("p").text())).toBe(
      "Strona opublikowana automatycznie 29 października 2026: data urodzenia zgadza się z oświadczeniami majątkowymi.",
    );
    // The link goes down to the section that lists them.
    expect(pointer.get("a").attributes("href")).toBe("#oswiadczenia-majatkowe");
    // The day and the short words never break across lines.
    expect(pointer.get("p").text()).toContain(
      ["29", "października", "2026"].join(NBSP),
    );
    expect(pointer.get("p").text()).toContain(`z${NBSP}oświadczeniami`);
  });

  it("says behind the (i) who reads a date: the program when it is sure, readers otherwise", async () => {
    answer({ ninfo: auto });
    // The real bubble is a tooltip, drawn only once it opens.
    const InfoBubble = defineComponent({
      props: { label: { type: String, default: "" } },
      setup(_props, { slots }) {
        return () => h("span", { "data-info": "" }, slots.default?.());
      },
    });
    const note = await mountSuspended(PersonDeclarationNote, {
      props: { nodeId: "ninfo" },
      global: { stubs: { InfoBubble } },
    });
    await flushPromises();

    // A typed date the program is not sure of, or a scan, goes to readers as
    // handwriting does; a date an admin settled never reaches this note.
    expect(line(note.get("[data-info]").text())).toBe(
      "Samorządowcy co roku składają oświadczenia majątkowe, a urząd publikuje je w swoim BIP. " +
        "Datę urodzenia z oświadczenia odczytuje program, gdy jest wpisana na komputerze i odczyt jest pewny, " +
        "a w pozostałych przypadkach - co najmniej 2 osoby, każda osobno i nie widząc daty z tej strony. " +
        "Odczyt zgadza się z datą urodzenia na tej stronie, więc to oświadczenie tej samej osoby. " +
        "Dlatego strona została opublikowana automatycznie, w ramach dziennego limitu, razem ze stanowiskami z KRS i startami w wyborach do tego samorządu.",
    );
  });

  it("only vouches for the date on a page published by hand", async () => {
    answer({ nhand: byHand });
    const note = await mountSuspended(PersonDeclarationNote, {
      props: { nodeId: "nhand" },
    });
    await flushPromises();

    const text = line(
      note.get('[data-testid="person-declarations-pointer"] p').text(),
    );
    expect(text).toBe("Data urodzenia zgadza się z oświadczeniem majątkowym.");
    expect(text).not.toContain("automatycznie");
  });

  it("asks once for the line and the section both", async () => {
    answer({ nboth: auto });
    // The person page draws both: the line in the header, the documents with
    // the articles further down.
    const Page = defineComponent({
      setup: () => () =>
        h("div", [
          h(PersonDeclarationNote, { nodeId: "nboth" }),
          h(MentionArticleList, { nodeId: "nboth", withDeclarations: true }),
        ]),
    });
    const page = await mountSuspended(Page);
    await flushPromises();

    expect(
      page.find('[data-testid="person-declarations-pointer"]').exists(),
    ).toBe(true);
    expect(page.findAll('[data-testid="person-declarations"]')).toHaveLength(2);
    expect(declarationCalls("nboth")).toHaveLength(1);
  });
});
