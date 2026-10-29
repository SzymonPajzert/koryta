import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import ReviewRow from "../../../app/components/admin/declarations/ReviewRow.vue";
import type { DeclarationReviewRow } from "../../../shared/declarations";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: ref({ uid: "admin" }), isAdmin: ref(true) }),
}));

const CROP = "data:image/png;base64,iVBORw0KGgo=";
const NOW = new Date("2026-10-29T13:00:00.000Z");

/** Two pages for one crop: one born on a day nobody typed, so its date shows
 * only where the page's date is drawn, the other with none. */
const disputed: DeclarationReviewRow = {
  id: `${"c".repeat(64)}-p0`,
  unit: "Koszalin (gmina miejska)",
  office: "Rada miasta",
  declarationYear: 2023,
  documentUrl: "https://bip.example.pl/oswiadczenia/2023/12.pdf",
  status: "disputed",
  readings: [
    { value: "1965-03-12", readers: 2 },
    { value: "1965-12-03", readers: 2 },
  ],
  unreadable: 0,
  agreed: null,
  agreedBy: null,
  machine: null,
  people: [
    {
      id: "fx0010",
      name: "Piotr Makieta",
      published: false,
      birthDate: "1964-02-11",
    },
    { id: "fx0011", name: "Piotr Makieta", published: true, birthDate: null },
  ],
  updatedAt: "2026-10-29T10:00:00.000Z",
};

/** Readers agreed; the page has the day and the month the other way round. */
const different: DeclarationReviewRow = {
  ...disputed,
  id: `${"d".repeat(64)}-p0`,
  status: "agreed",
  readings: [{ value: "1965-03-12", readers: 3 }],
  agreed: "1965-03-12",
  agreedBy: "readers",
  people: [
    {
      id: "fx0012",
      name: "Anna Szablon",
      published: false,
      birthDate: "1965-12-03",
    },
  ],
};

const mountRow = (
  row: DeclarationReviewRow,
  kind: "disputed" | "different",
  expanded = true,
) =>
  mountSuspended(ReviewRow, {
    props: { row, kind, now: NOW, expanded },
  });

describe("AdminDeclarationsReviewRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthRequest.mockResolvedValue({ date: CROP, name: null });
  });

  it("keeps the pages' dates out of sight until asked", async () => {
    // A date the admin settles that matches the page is taken for a match,
    // so the page's date must not sit beside the crop the admin is reading:
    // not in the text, and not in an attribute a screen reader would say.
    const row = await mountRow(disputed, "disputed");
    await flushPromises();

    expect(row.html()).not.toContain("11.02.1964");
    expect(row.html()).not.toContain("1964-02-11");
    expect(row.findAll("[data-page-date]")).toHaveLength(0);
    expect(row.find("[data-difference]").exists()).toBe(false);
    const reveal = row.get("[data-reveal-dates]");
    expect(reveal.text()).toBe("Pokaż daty ze stron");

    await reveal.trigger("click");

    expect(row.findAll("[data-page-date]").map((date) => date.text())).toEqual([
      "na stronie: 11.02.1964",
      "na stronie: brak",
    ]);
    expect(row.find("[data-reveal-dates]").exists()).toBe(false);
  });

  it("puts a contradicted page's date beside the reading at once", async () => {
    // Here the comparison is the decision, so there is nothing to hide.
    const row = await mountRow(different, "different");
    await flushPromises();

    expect(row.find("[data-reveal-dates]").exists()).toBe(false);
    const compared = row.findAll('[data-difference="swap"]');
    // On the line and beside the page in the open row.
    expect(compared).toHaveLength(2);
    expect(compared[0]!.text()).toContain("12.03.1965");
    expect(compared[0]!.text()).toContain("03.12.1965");
    expect(row.text()).toContain("dzień ⇄ miesiąc");
  });

  it("fetches the crop when the row opens, and only once", async () => {
    const row = await mountRow(disputed, "disputed", false);
    await flushPromises();
    expect(mockAuthRequest).not.toHaveBeenCalled();
    expect(row.find("img").exists()).toBe(false);

    await row.setProps({ expanded: true });
    await flushPromises();
    expect(mockAuthRequest).toHaveBeenCalledWith(
      `/api/declarations/${encodeURIComponent(disputed.id)}/images`,
      { method: "GET" },
    );
    expect(row.get('[data-crop="date"] img').attributes("src")).toBe(CROP);
    // No name crop came, so none is drawn.
    expect(row.find('[data-crop="name"]').exists()).toBe(false);

    await row.setProps({ expanded: false });
    await row.setProps({ expanded: true });
    await flushPromises();
    expect(mockAuthRequest).toHaveBeenCalledTimes(1);
  });

  it("says when the crop would not load, and tries again", async () => {
    mockAuthRequest.mockRejectedValueOnce(new Error("503"));
    const row = await mountRow(disputed, "disputed");
    await flushPromises();

    const error = row.get("[data-crop-error]");
    expect(error.text()).toContain("Nie udało się wczytać wycinka.");
    await error.get("button").trigger("click");
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledTimes(2);
    expect(row.get('[data-crop="date"] img').attributes("src")).toBe(CROP);
  });

  it("says a date the job read itself came without a picture", async () => {
    mockAuthRequest.mockResolvedValue({ date: null, name: null });
    const row = await mountRow(
      {
        ...different,
        readings: [],
        agreedBy: "machine",
        machine: { birthDate: "1965-03-12", confidence: "high" },
      },
      "different",
    );
    await flushPromises();

    expect(row.find("img").exists()).toBe(false);
    expect(row.find("[data-crop-error]").exists()).toBe(false);
    expect(row.get("[data-crop-missing]").text()).toBe(
      "Zadanie odczytało tę datę samo i nie przysłało wycinka.",
    );
    // The whole form is still a click away.
    expect(row.get("[data-document-link]").attributes("href")).toBe(
      different.documentUrl,
    );
  });

  it("says whose a contradicted date is, and calls only readers' agreement agreed", async () => {
    // Readers agreed on it.
    let row = await mountRow(different, "different");
    await flushPromises();
    expect(row.get("[data-agreed-by]").text()).toBe("czytelnicy");
    expect(row.get("[data-agreed-tag]").text()).toBe("uzgodniony");
    row.unmount();

    // An admin took a reading two readers typed, out of a dispute: it is the
    // admin's, not an agreement.
    row = await mountRow(
      {
        ...different,
        readings: [
          { value: "1965-03-12", readers: 2 },
          { value: "1965-12-30", readers: 2 },
        ],
        agreedBy: "admin",
      },
      "different",
    );
    await flushPromises();
    expect(row.get("[data-agreed-by]").text()).toBe("administrator");
    expect(row.get("[data-agreed-tag]").text()).toBe("przyjęty");
    expect(row.text()).not.toContain("uzgodniony");
    row.unmount();

    // The job read it off a typed form at upload; no reader ever did, and
    // none is still to come.
    row = await mountRow(
      { ...different, readings: [], agreedBy: "machine" },
      "different",
    );
    await flushPromises();
    expect(row.get("[data-agreed-by]").text()).toBe(
      "zadanie, z daty wpisanej na komputerze",
    );
    expect(row.find("[data-agreed-tag]").exists()).toBe(false);
    expect(row.get("[data-no-readings]").text()).toBe(
      "Nikt z czytelników nie odczytał tego wycinka: datę odczytało zadanie.",
    );
    expect(row.text()).not.toContain("Nikt jeszcze nie odpowiedział");
    row.unmount();

    // A dispute has no date of anybody's yet.
    row = await mountRow(disputed, "disputed");
    await flushPromises();
    expect(row.find("[data-agreed-by]").exists()).toBe(false);
    expect(row.find("[data-agreed-tag]").exists()).toBe(false);
  });

  it("asks the page for the decisions rather than making them", async () => {
    const row = await mountRow(disputed, "disputed");
    await flushPromises();

    await row.findAll("[data-settle-reading]")[1]!.trigger("click");
    await row.get("[data-unreadable]").trigger("click");
    // Withdrawing asks first.
    await row.get("[data-withdraw]").trigger("click");
    expect(row.emitted("withdraw")).toBeUndefined();
    await row.get("[data-withdraw-confirm]").trigger("click");

    expect(row.emitted("settle")).toEqual([["1965-12-03"]]);
    expect(row.emitted("unreadable")).toHaveLength(1);
    expect(row.emitted("withdraw")).toHaveLength(1);
    // The admin's own requests are the page's: the row sent only the crop's.
    expect(mockAuthRequest).toHaveBeenCalledTimes(1);
  });
});
