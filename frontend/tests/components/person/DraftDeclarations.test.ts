import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import PersonDraftDeclarations from "../../../app/components/person/DraftDeclarations.vue";
import type {
  PersonDeclarationCrop,
  PersonDeclarationCrops,
} from "../../../shared/declarations";

const { mockAuthRequest, isAdmin } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  isAdmin: { value: false },
}));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({
    user: ref({ uid: "reader" }),
    isAdmin: ref(isAdmin.value),
  }),
}));

const PNG = "data:image/png;base64,AAAA";

function crop(
  fields: Partial<PersonDeclarationCrop> = {},
): PersonDeclarationCrop {
  return {
    id: "open-p0",
    status: "open",
    failure: null,
    unit: "Strzelin (gmina miejsko-wiejska)",
    office: "Rada gminy",
    documentUrl: "https://bip.strzelin.pl/download/1",
    answers: 1,
    agreed: null,
    agreedBy: null,
    outcome: null,
    imageSize: {
      date: { width: 950, height: 105 },
      name: { width: 1160, height: 94 },
    },
    ...fields,
  };
}

/** The endpoints, by node: its crops, every crop's pictures, and a link
 * given, which the node's answer then lists as this reader's. */
function answer(byNode: Record<string, PersonDeclarationCrops>) {
  mockAuthRequest.mockImplementation(
    async (url: string, options?: { body?: { url: string } }) => {
      const linked = /^\/api\/nodes\/([^/]+)\/declaration-links$/.exec(
        url,
      )?.[1];
      if (linked) {
        const page = byNode[linked]!;
        page.links = [
          ...page.links,
          { url: options!.body!.url, at: new Date().toISOString(), mine: true },
        ];
        return structuredClone(page);
      }
      const node = /^\/api\/nodes\/([^/]+)\/declaration-crops$/.exec(url)?.[1];
      if (node) {
        const found = byNode[node];
        if (found) return found;
        throw Object.assign(new Error("No draft"), { statusCode: 404 });
      }
      if (/^\/api\/declarations\/[^/]+\/images$/.test(url)) {
        return { date: PNG, name: PNG };
      }
      throw new Error(`unexpected ${url}`);
    },
  );
}

const imageCalls = () =>
  mockAuthRequest.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.endsWith("/images"));

async function mount(nodeId: string) {
  const block = await mountSuspended(PersonDraftDeclarations, {
    props: { nodeId, birthDate: "1979-07-15" },
  });
  await flushPromises();
  return block;
}

// Each test asks for its own node: the request is keyed by it.
describe("PersonDraftDeclarations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdmin.value = false;
  });

  it("shows nothing for a draft with nothing to say, or when the endpoint refuses", async () => {
    answer({
      empty: { publication: null, crops: [], searches: [], links: [] },
    });
    const empty = await mount("empty");
    expect(
      empty.find('[data-testid="person-draft-declarations"]').exists(),
    ).toBe(false);
    const refused = await mount("refused");
    expect(
      refused.find('[data-testid="person-draft-declarations"]').exists(),
    ).toBe(false);
    expect(imageCalls()).toEqual([]);
  });

  it("draws the crop the line is about, and the rest when asked", async () => {
    answer({
      three: {
        publication: null,
        crops: [
          crop(),
          crop({ id: "second-p0", answers: 0 }),
          crop({ id: "third-p0", answers: 0 }),
        ],
        searches: [],
        links: [],
      },
    });
    const block = await mount("three");

    expect(block.find("#ddecl-line").text()).toBe(
      "3 oświadczenia majątkowe czekają na czytelników.",
    );
    expect(block.findAll('[data-testid="draft-declaration"]')).toHaveLength(1);
    expect(imageCalls()).toEqual(["/api/declarations/open-p0/images"]);
    expect(block.find('[data-testid="draft-declaration"]').text()).toContain(
      "czeka na czytelników, 1 odpowiedź",
    );
    expect(block.find("[data-document-link]").attributes("href")).toBe(
      "https://bip.strzelin.pl/download/1",
    );

    await block.find("[data-show-all]").trigger("click");
    await flushPromises();
    expect(block.findAll('[data-testid="draft-declaration"]')).toHaveLength(3);
    expect(imageCalls()).toHaveLength(3);
  });

  it("tells only an admin what to do about a held page", async () => {
    const held: PersonDeclarationCrops = {
      publication: { status: "held", reason: "two_places", paidPost: true },
      crops: [
        crop({
          status: "agreed",
          agreed: "1979-07-15",
          agreedBy: "readers",
          outcome: "queued",
        }),
      ],
      searches: [],
      links: [],
    };
    answer({ held, held2: held });

    const reader = await mount("held");
    expect(reader.find("#ddecl-line").text()).toBe(
      "Automatyczna publikacja wstrzymana: kandydatura w dwóch miejscach naraz.",
    );
    expect(reader.find("[data-admin-note]").exists()).toBe(false);
    // One crop: nothing to fold.
    expect(reader.find("[data-show-all]").exists()).toBe(false);

    isAdmin.value = true;
    const admin = await mount("held2");
    expect(admin.find("[data-admin-note]").text()).toBe(
      "Kandydatury wypadają w dwóch miejscach naraz. Przy publikacji ręcznej zaznacz tylko właściwą.",
    );
  });

  it("lists the elections won and where the crawler looked, for a draft with no crop", async () => {
    answer({
      missing: {
        publication: null,
        crops: [],
        searches: [
          {
            year: 2024,
            office: "Wójt",
            unit: "powiat strzeliński",
            status: null,
            reason: null,
            files: 0,
            bipUrl: null,
          },
          {
            year: 2018,
            office: "Rada gminy",
            unit: "Strzelin (gmina miejsko-wiejska)",
            status: "not_found",
            reason: "unreachable",
            files: 0,
            bipUrl: "https://bip.strzelin.pl/rada",
          },
        ],
        links: [],
      },
    });
    const block = await mount("missing");

    expect(block.find("#ddecl-line").text()).toBe(
      "Nie mamy oświadczenia majątkowego.",
    );
    const rows = block.findAll('[data-testid="draft-declaration-search"]');
    expect(rows.map((row) => row.text().replace(/\s+/g, " "))).toEqual([
      "wybory 2024 Wójt powiat strzeliński jeszcze nie szukaliśmy",
      "wybory 2018 Rada gminy Strzelin (gmina miejsko-wiejska) nie znaleziono: BIP nie odpowiada bip.strzelin.pl",
    ]);
    expect(rows[1]!.find("[data-bip-link]").attributes("href")).toBe(
      "https://bip.strzelin.pl/rada",
    );
    expect(block.find("[data-show-all]").exists()).toBe(false);
    expect(imageCalls()).toEqual([]);
  });

  it("says a declaration nothing was cut from is linked all the same", async () => {
    answer({
      failed: {
        publication: null,
        crops: [
          crop({
            id: "failed-p0",
            status: "failed",
            failure: "blank_field",
            imageSize: null,
          }),
        ],
        searches: [],
        links: [],
      },
    });
    const block = await mount("failed");

    expect(block.find("#ddecl-line").text()).toBe(
      "Z oświadczenia majątkowego nie udało się wyciąć daty urodzenia.",
    );
    const clip = block.find('[data-testid="draft-declaration"]');
    expect(clip.text()).toContain("bez wycinka: puste pole daty");
    expect(clip.text()).not.toContain("Datę odczytał program");
    expect(clip.find("[data-document-link]").exists()).toBe(true);
    expect(imageCalls()).toEqual([]);
  });

  it("takes a link found by hand and lists it as the reader's", async () => {
    answer({
      linking: {
        publication: null,
        crops: [],
        searches: [
          {
            year: 2018,
            office: "Rada gminy",
            unit: "Strzelin (gmina miejsko-wiejska)",
            status: "not_found",
            reason: "not_listed",
            files: 0,
            bipUrl: null,
          },
        ],
        links: [],
      },
    });
    const block = await mount("linking");
    const add = block.find("[data-link-add]");
    expect(add.attributes("disabled")).toBeDefined();

    await block.find("[data-link-field] input").setValue("bip.strzelin.pl");
    expect(add.attributes("disabled")).toBeDefined();

    const url = "https://bip.strzelin.pl/rada/kowalska.pdf";
    await block.find("[data-link-field] input").setValue(url);
    expect(add.attributes("disabled")).toBeUndefined();
    await block.find('[data-testid="draft-declaration-add"]').trigger("submit");
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledWith(
      "/api/nodes/linking/declaration-links",
      { method: "POST", body: { url } },
    );
    const given = block.findAll('[data-testid="draft-declaration-link"]');
    expect(given).toHaveLength(1);
    expect(given[0]!.text().replace(/\s+/g, " ")).toBe(
      "bip.strzelin.pl/rada/kowalska.pdf dziś, przez Ciebie",
    );
    expect(given[0]!.find("a").attributes("rel")).toBe("noopener nofollow ugc");
    expect(
      (block.find("[data-link-field] input").element as HTMLInputElement).value,
    ).toBe("");
  });

  it("says why a link was refused, in the server's words for the day's limit", async () => {
    answer({
      limited: {
        publication: null,
        crops: [],
        searches: [],
        links: [
          {
            url: "https://bip.strzelin.pl/a.pdf",
            at: "2026-11-18T10:00:00Z",
            mine: false,
          },
        ],
      },
    });
    const block = await mount("limited");
    mockAuthRequest.mockImplementationOnce(async () => {
      throw Object.assign(new Error("429"), {
        statusCode: 429,
        data: {
          message: "Na dziś przyjęliśmy już tyle Twoich linków, ile możemy.",
        },
      });
    });
    await block
      .find("[data-link-field] input")
      .setValue("https://bip.strzelin.pl/b.pdf");
    await block.find('[data-testid="draft-declaration-add"]').trigger("submit");
    await flushPromises();

    expect(block.find("[data-link-field]").text()).toContain(
      "Na dziś przyjęliśmy już tyle Twoich linków, ile możemy.",
    );
    // Somebody else's link, from another day.
    expect(
      block.find('[data-testid="draft-declaration-link"]').text(),
    ).toContain("18 listopada 2026");
  });
});
